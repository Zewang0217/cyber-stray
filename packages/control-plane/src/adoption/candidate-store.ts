import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { CandidateRequest, CandidatesResult } from './candidates.js';

const MAX_ATTEMPTS_PER_STEP = 4;
const storedResult = z.object({ candidates: z.array(z.string().min(1)).length(3), source: z.literal('llm') });
const ledgerSchema = z.object({
  attempts: z.array(z.object({
    key: z.string(), step: z.enum(['name', 'catchphrase']),
    status: z.enum(['pending', 'completed', 'failed']), result: storedResult.optional(),
  })).max(MAX_ATTEMPTS_PER_STEP * 2),
});
type Ledger = z.infer<typeof ledgerSchema>;
const queues = new Map<string, Promise<unknown>>();

/** An explicit, recoverable candidate error; users can always enter their own text. */
export class CandidateRequestError extends Error {
  constructor(message: string, readonly status: 409 | 429 | 502 | 503) { super(message); }
}

async function loadLedger(path: string): Promise<Ledger> {
  try { return ledgerSchema.parse(JSON.parse(await readFile(path, 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { attempts: [] };
    throw new Error('领养候选额度记录损坏或不可读取', { cause: error });
  }
}

async function saveLedger(path: string, ledger: Ledger): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(ledger), { mode: 0o600 });
  await rename(temp, path);
}

async function generateReserved(
  tenantDir: string, request: CandidateRequest, generate: () => Promise<CandidatesResult>,
): Promise<CandidatesResult> {
  const dir = join(tenantDir, 'adoption');
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'candidates.json');
  const ledger = await loadLedger(path);
  const key = createHash('sha256').update(JSON.stringify([
    request.step, request.batch ?? 0, request.name ?? '', request.personality ?? '',
  ])).digest('hex');
  const previous = ledger.attempts.find((a) => a.key === key);
  if (previous?.status === 'completed') return storedResult.parse(previous.result);
  if (previous) throw new CandidateRequestError('这批候选生成未完成；请选择换一批或手动填写', 409);
  if (ledger.attempts.filter((a) => a.step === request.step).length >= MAX_ATTEMPTS_PER_STEP) {
    throw new CandidateRequestError('这一步已用完 4 批候选，请手动填写', 429);
  }
  const attempt: Ledger['attempts'][number] = { key, step: request.step, status: 'pending' };
  ledger.attempts.push(attempt);
  // Reserve durably before the paid call: a crash must not make a consumed attempt free to replay.
  await saveLedger(path, ledger);
  try {
    const result = storedResult.parse(await generate());
    attempt.status = 'completed';
    attempt.result = result;
    await saveLedger(path, ledger);
    return result;
  } catch (error) {
    attempt.status = 'failed';
    await saveLedger(path, ledger);
    throw error;
  }
}

/** CP is a single process: serialize each tenant across routes and service instances, replay from disk. */
export function generateOnce(
  tenantDir: string, request: CandidateRequest, generate: () => Promise<CandidatesResult>,
): Promise<CandidatesResult> {
  const prior = queues.get(tenantDir) ?? Promise.resolve();
  const run = prior.then(() => generateReserved(tenantDir, request, generate));
  const settled = run.catch(() => undefined);
  queues.set(tenantDir, settled);
  void settled.then(() => { if (queues.get(tenantDir) === settled) queues.delete(tenantDir); });
  return run;
}
