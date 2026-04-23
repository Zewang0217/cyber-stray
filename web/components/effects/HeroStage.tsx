"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence, useSpring } from "framer-motion";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, Environment, ContactShadows } from "@react-three/drei";
import { createPortal } from "react-dom";
import * as THREE from "three";

useGLTF.preload("/low_poly_dog.glb");

// ==================== The Actor: 3D Dog with Procedural Animation ====================
function DogModel() {
    const { scene } = useGLTF("/low_poly_dog.glb");
    const modelRef = useRef<THREE.Group>(null);
    const baseScale = useRef<number>(1); // 记录基础缩放比例

    const clonedScene = useMemo(() => {
        const cloned = scene.clone();
        cloned.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                // 高级黑曜石装甲材质
                child.material = new THREE.MeshStandardMaterial({
                    color: "#11111b", // 极暗的底色
                    metalness: 0.8, // 强金属反光
                    roughness: 0.3, // 适度粗糙让高光散开
                    emissive: "#cba6f7", // 极其微弱的紫光保底
                    emissiveIntensity: 0.05,
                });
            }
        });
        return cloned;
    }, [scene]);

    useEffect(() => {
        if (modelRef.current) {
            const box = new THREE.Box3().setFromObject(modelRef.current);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);

            // 调整这里的数字可以改变狗的绝对大小 (把 2 改成 2.5 或 3 可以放大)
            const scale = 3 / maxDim;
            baseScale.current = scale; // 保存起来供动画使用

            modelRef.current.scale.setScalar(scale);
            modelRef.current.position.x = -center.x * scale;
            // 让狗稍微抬高一点点，对齐地面的 ContactShadows
            modelRef.current.position.y = -center.y * scale + 0.5;
            modelRef.current.position.z = -center.z * scale;
        }
    }, []);

    // 注入生命力 (Procedural Animation)
    useFrame((state, delta) => {
        if (modelRef.current) {
            const t = state.clock.elapsedTime;

            // 1. 呼吸感 (Y轴轻微缩放)
            const breathe = 1 + Math.sin(t * 3) * 0.015;
            modelRef.current.scale.y = baseScale.current * breathe;

            // 2. 警觉的巡视感 (不规则的旋转)
            // 使用组合正弦波制造出一种 "四处张望" 的错觉
            const lookAroundY =
                Math.sin(t * 0.8) * 0.15 + Math.sin(t * 2.1) * 0.05;
            const lookAroundX = Math.cos(t * 1.2) * 0.05;

            // 平滑插值过渡
            modelRef.current.rotation.y +=
                (lookAroundY - modelRef.current.rotation.y) * delta * 2;
            modelRef.current.rotation.x +=
                (lookAroundX - modelRef.current.rotation.x) * delta * 2;
        }
    });

    return (
        <group ref={modelRef}>
            <primitive object={clonedScene} />
        </group>
    );
}

// ==================== The Stage: Curtains and Dog Container ====================
function CurtainSection({
    onCurtainOpen,
    onDogLanded,
}: {
    onCurtainOpen: () => void;
    onDogLanded: () => void;
}) {
    const [showDog, setShowDog] = useState(false);
    const [dogLanded, setDogLanded] = useState(false);
    const [laserDone, setLaserDone] = useState(false);

    // 加重下落的重力感
    const dogY = useSpring("-150%", {
        stiffness: 120,
        damping: 10,
        mass: 3,
    });

    useEffect(() => {
        const dogTimer = setTimeout(() => {
            setShowDog(true);
            dogY.set("0%");
            onCurtainOpen();
        }, 2000); // 稍微提前狗的出场时间，紧跟开门

        const landTimer = setTimeout(() => {
            setDogLanded(true);
            onDogLanded();
        }, 2800);

        return () => {
            clearTimeout(dogTimer);
            clearTimeout(landTimer);
        };
    }, [dogY, onCurtainOpen, onDogLanded]);

    return (
        <div className="absolute inset-0 z-10 overflow-hidden">
            {/* 激光切割线 */}
            <motion.div
                className="absolute top-0 bottom-0 left-1/2 w-[2px] -translate-x-1/2 z-30"
                style={{
                    background: "#cba6f7",
                    boxShadow: "0 0 15px 5px oklch(0.7 0.3 300 / 0.8)",
                }}
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: [0, 1, 0], scaleY: [0, 1, 1] }}
                transition={{ duration: 1, times: [0, 0.8, 1], delay: 0.3 }}
                onAnimationComplete={() => setLaserDone(true)}
            />

            {/* 左闸门 */}
            <motion.div
                className="absolute top-0 bottom-0 left-0 w-1/2 z-20"
                style={{
                    background: `repeating-linear-gradient(0deg, #09090b 0px, #09090b 4px, #11111b 4px, #11111b 8px)`,
                    boxShadow: "inset -10px 0 30px rgba(0,0,0,0.8)",
                }}
                initial={{ x: 0 }}
                animate={laserDone ? { x: "-100%" } : { x: 0 }}
                transition={{
                    delay: 0.3,
                    duration: 1.8,
                    ease: [0.76, 0, 0.24, 1],
                }}
            />

            {/* 右闸门 */}
            <motion.div
                className="absolute top-0 bottom-0 right-0 w-1/2 z-20"
                style={{
                    background: `repeating-linear-gradient(0deg, #09090b 0px, #09090b 4px, #11111b 4px, #11111b 8px)`,
                    boxShadow: "inset 10px 0 30px rgba(0,0,0,0.8)",
                }}
                initial={{ x: 0 }}
                animate={laserDone ? { x: "100%" } : { x: 0 }}
                transition={{
                    delay: 0.3,
                    duration: 1.8,
                    ease: [0.76, 0, 0.24, 1],
                }}
            />

            {/* 3D 渲染区：必须是全屏 (w-full h-full)，给摄像机足够的空间 */}
            <AnimatePresence>
                {showDog && (
                    <motion.div
                        className="absolute inset-0 w-full h-full z-[15]"
                        style={{ y: dogY }}
                    >
                        <Canvas
                            // 摄像机稍微抬高(1.5)并往后拉(12)，形成完美的全身视角
                            camera={{
                                position: [0, 1.5, 12],
                                fov: 45,
                                near: 0.1,
                                far: 1000,
                            }}
                            gl={{ antialias: true, alpha: true }}
                        >
                            <ambientLight intensity={0.5} color="#1e1e2e" />

                            {/* 强烈的双色边缘光 */}
                            <directionalLight
                                position={[5, 2, -5]}
                                intensity={8}
                                color="#cba6f7"
                            />
                            <directionalLight
                                position={[-5, 2, 5]}
                                intensity={8}
                                color="#89b4fa"
                            />

                            {/* 加入环境光让金属有东西可以反射 */}
                            <Environment preset="city" />

                            <DogModel />

                            {/* 狗底部的物理接触阴影，增加落地真实感 */}
                            <ContactShadows
                                position={[0, -1.5, 0]}
                                opacity={0.6}
                                scale={15}
                                blur={2.5}
                                far={4}
                                color="#000000"
                            />
                        </Canvas>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* 落地冲击波光晕 */}
            <AnimatePresence>
                {dogLanded && (
                    <motion.div
                        className="absolute inset-0 flex items-center justify-center pointer-events-none z-[14]"
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: [0, 0.8, 0], scale: [0.5, 3, 4] }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1, ease: "easeOut" }}
                    >
                        <div
                            className="w-[30vw] h-[30vw] min-w-[300px] min-h-[300px] rounded-full"
                            style={{
                                background:
                                    "radial-gradient(circle, oklch(0.7 0.3 300 / 0.5) 0%, transparent 60%)",
                                filter: "blur(30px)",
                                transform: "translateY(20%) scaleY(0.3)", // 把圆形压扁成椭圆贴在地上
                            }}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ==================== The Credits (字幕与按钮) ====================
// (这部分保持你之前的实现，非常不错，只微调了层级和阴影)
function CreditsSection({
    show,
    onEnter,
}: {
    show: boolean;
    onEnter?: () => void;
}) {
    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: { staggerChildren: 0.1, delayChildren: 0.2 },
        },
    };
    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        visible: {
            opacity: 1,
            y: 0,
            transition: {
                duration: 0.8,
                ease: [0.25, 0.46, 0.45, 0.94] as const,
            },
        },
    };

    return (
        <AnimatePresence>
            {show && (
                <motion.div
                    className="absolute inset-0 flex flex-col items-center justify-end pb-24 z-30 pointer-events-none"
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                >
                    <motion.h1
                        className="font-[family-name:var(--font-space-grotesk)] text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-white/50 tracking-tight mb-2"
                        variants={itemVariants}
                    >
                        CYBER STRAY
                    </motion.h1>
                    <motion.p
                        className="text-lg md:text-xl text-[#a6adc8] tracking-widest uppercase font-mono mb-10"
                        variants={itemVariants}
                    >
                        System Online // Automated Hound
                    </motion.p>
                    <motion.button
                        className="pointer-events-auto px-10 py-4 rounded-full text-white font-medium
              backdrop-blur-xl bg-white/5 border border-white/10
              hover:bg-white/15 hover:border-white/20
              transition-all duration-300
              shadow-[0_0_40px_oklch(0.7_0.3_300_/0.15)] hover:shadow-[0_0_60px_oklch(0.7_0.3_300_/0.3)]"
                        variants={itemVariants}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={onEnter}
                    >
                        WAKE IT UP
                    </motion.button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

// ... 你的 TiltBackground 保持不变 ...
function TiltBackground() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [transform, setTransform] = useState({ rotateX: 0, rotateY: 0 });

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const mouseX = e.clientX - centerX;
            const mouseY = e.clientY - centerY;
            const rotateY = (mouseX / (rect.width / 2)) * 3;
            const rotateX = -(mouseY / (rect.height / 2)) * 3;
            setTransform({ rotateX, rotateY });
        };
        const handleMouseLeave = () => setTransform({ rotateX: 0, rotateY: 0 });
        const container = containerRef.current;
        if (container) {
            container.addEventListener("mousemove", handleMouseMove);
            container.addEventListener("mouseleave", handleMouseLeave);
        }
        return () => {
            if (container) {
                container.removeEventListener("mousemove", handleMouseMove);
                container.removeEventListener("mouseleave", handleMouseLeave);
            }
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 z-0 overflow-hidden"
            style={{ perspective: "1000px" }}
        >
            <div
                className="absolute inset-0 transition-transform duration-200 ease-out"
                style={{
                    transform: `rotateX(${transform.rotateX}deg) rotateY(${transform.rotateY}deg) scale(1.05)`,
                    background: `
            radial-gradient(ellipse at 30% 20%, oklch(0.25 0.1 280 / 0.3) 0%, transparent 60%),
            radial-gradient(ellipse at 70% 80%, oklch(0.2 0.08 300 / 0.2) 0%, transparent 60%),
            radial-gradient(circle at center, #09090b 0%, #000000 100%)
          `,
                }}
            />
        </div>
    );
}

// ==================== Main Assembly ====================
export function HeroStage({ onEnter }: { onEnter?: () => void }) {
    const [curtainOpen, setCurtainOpen] = useState(false);
    const [showCredits, setShowCredits] = useState(false);
    const [shake, setShake] = useState(false);

    // 用于确保 Portal 只在客户端渲染，防止 Next.js 报错
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // 因为 page.tsx 已经拦截了，这里的 isSkipped 逻辑可以极度简化
    useEffect(() => {
        if (curtainOpen) {
            const timer = setTimeout(() => setShowCredits(true), 1500);
            return () => clearTimeout(timer);
        }
    }, [curtainOpen]);

    const handleSkip = useCallback(() => {
        sessionStorage.setItem("cyber_intro_played", "true");
        onEnter?.();
    }, [onEnter]);

    const handleEnterClick = useCallback(() => {
        sessionStorage.setItem("cyber_intro_played", "true");
        onEnter?.();
    }, [onEnter]);

    const handleDogLanded = useCallback(() => {
        setShake(true);
        setTimeout(() => setShake(false), 300);
    }, []);

    // 如果还没挂载（SSR 阶段），什么都不渲染
    if (!mounted) return null;

    // 将我们要渲染的 DOM 打包
    const stageContent = (
        <motion.div
            // 现在的 z-[9999] 绝对有效了，因为它在 <body> 根节点下！
            className="fixed inset-0 w-full h-full overflow-hidden bg-[#09090b] z-[9999]"
            animate={shake ? { y: [0, 15, -8, 0] } : { y: 0 }}
            transition={{ duration: 0.3 }}
        >
            <TiltBackground />
            <CurtainSection
                onCurtainOpen={() => setCurtainOpen(true)}
                onDogLanded={handleDogLanded}
            />
            <CreditsSection show={showCredits} onEnter={handleEnterClick} />

            <motion.button
                className="absolute top-6 right-6 z-50 px-4 py-2 text-sm text-white/40
          backdrop-blur-md bg-white/5 rounded-full border border-white/10
          hover:text-white/90 hover:bg-white/10 transition-colors"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1 }}
                onClick={handleSkip}
            >
                Skip Init
            </motion.button>
        </motion.div>
    );

    // 终极魔法：传送到 body 最外层！
    return createPortal(stageContent, document.body);
}
