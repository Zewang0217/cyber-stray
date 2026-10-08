const DAYLIGHT_START_HOUR = 6;
const DAYLIGHT_END_HOUR = 18;

/** 场景光照跟随持机人的本地时间；宠物睡眠和预算状态不改变太阳的位置。 */
export function isStreetDaytime(now: Date): boolean {
  const hour = now.getHours();
  return hour >= DAYLIGHT_START_HOUR && hour < DAYLIGHT_END_HOUR;
}
