"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { motion, AnimatePresence, useSpring } from "framer-motion";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

useGLTF.preload("/low_poly_dog.glb");

function DogModel() {
  const { scene } = useGLTF("/low_poly_dog.glb");
  const modelRef = useRef<THREE.Group>(null);

  const clonedScene = useMemo(() => {
    const cloned = scene.clone();
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.material = new THREE.MeshPhysicalMaterial({
          color: "#1e1e2e",
          emissive: "#cba6f7",
          emissiveIntensity: 0.5,
          metalness: 0.9,
          roughness: 0.1,
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
      const scale = 2 / maxDim;
      modelRef.current.scale.setScalar(scale);
      modelRef.current.position.x = -center.x * scale;
      modelRef.current.position.y = -center.y * scale;
      modelRef.current.position.z = -center.z * scale;
    }
  }, []);

  useFrame((state) => {
    if (modelRef.current) {
      const t = state.clock.elapsedTime;
      modelRef.current.rotation.y = Math.sin(t * 0.5) * 0.1;
      modelRef.current.position.y += Math.sin(t * 2) * 0.002;
    }
  });

  return (
    <group ref={modelRef}>
      <primitive object={clonedScene} />
    </group>
  );
}

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

  const dogY = useSpring("-200%", {
    stiffness: 150,
    damping: 12,
    mass: 2,
  });

  useEffect(() => {
    const dogTimer = setTimeout(() => {
      setShowDog(true);
      dogY.set("0%");
      onCurtainOpen();
    }, 2300);

    const landTimer = setTimeout(() => {
      setDogLanded(true);
      onDogLanded();
    }, 3000);

    return () => {
      clearTimeout(dogTimer);
      clearTimeout(landTimer);
    };
  }, [dogY, onCurtainOpen, onDogLanded]);

  return (
    <div className="absolute inset-0 z-10">
      {/* Center Laser Cutting Line */}
      <motion.div
        className="absolute top-0 bottom-0 left-1/2 w-[2px] -translate-x-1/2 z-30"
        style={{ background: "#cba6f7", boxShadow: "0 0 12px 4px oklch(0.7 0.3 300 / 0.6)" }}
        initial={{ opacity: 0, scaleY: 0 }}
        animate={{ opacity: [0, 1, 0], scaleY: [0, 1, 1] }}
        transition={{ duration: 1, times: [0, 0.8, 1], delay: 0.3 }}
        onAnimationComplete={() => setLaserDone(true)}
      />

      {/* Left Gate */}
      <motion.div
        className="absolute top-0 bottom-0 left-0 w-1/2 z-20"
        style={{
          background: `repeating-linear-gradient(
            0deg,
            #11111b 0px,
            #11111b 3px,
            #181825 3px,
            #181825 6px
          )`,
          boxShadow: "inset -8px 0 20px rgba(0,0,0,0.6)",
        }}
        initial={{ x: 0 }}
        animate={laserDone ? { x: "-100%" } : { x: 0 }}
        transition={{
          delay: 0.8,
          duration: 1.5,
          ease: [0.76, 0, 0.24, 1],
        }}
      />

      {/* Right Gate */}
      <motion.div
        className="absolute top-0 bottom-0 right-0 w-1/2 z-20"
        style={{
          background: `repeating-linear-gradient(
            0deg,
            #11111b 0px,
            #11111b 3px,
            #181825 3px,
            #181825 6px
          )`,
          boxShadow: "inset 8px 0 20px rgba(0,0,0,0.6)",
        }}
        initial={{ x: 0 }}
        animate={laserDone ? { x: "100%" } : { x: 0 }}
        transition={{
          delay: 0.8,
          duration: 1.5,
          ease: [0.76, 0, 0.24, 1],
        }}
      />

      {/* Dog Container */}
      <AnimatePresence>
        {showDog && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center z-[15]"
            style={{ y: dogY }}
          >
            <div className="w-64 h-64 md:w-80 md:h-80">
              <Canvas
                camera={{ position: [0, 0, 8], fov: 50, near: 0.1, far: 1000 }}
                gl={{ antialias: true, alpha: true }}
              >
                <ambientLight intensity={0.6} />
                <hemisphereLight intensity={0.4} groundColor="#444" />
                <directionalLight position={[5, 5, 5]} intensity={1.2} />
                <pointLight position={[-5, -5, -5]} intensity={0.5} color="#8b5cf6" />
                <DogModel />
              </Canvas>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Impact Glow Effect */}
      <AnimatePresence>
        {dogLanded && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-[15]"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: [0, 0.6, 0], scale: [0.5, 2, 2.5] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <div
              className="w-64 h-64 rounded-full"
              style={{
                background: "radial-gradient(circle, oklch(0.7 0.3 300) 0%, transparent 70%)",
                filter: "blur(20px)",
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
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
          className="absolute inset-0 flex flex-col items-center justify-end pb-32 z-30 pointer-events-none"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.h1
            className="font-[family-name:var(--font-space-grotesk)] text-6xl md:text-8xl font-bold text-white tracking-tight mb-4"
            variants={itemVariants}
            style={{
              textShadow: "0 0 40px oklch(0.7 0.3 300 / 0.5)",
            }}
          >
            CYBER STRAY
          </motion.h1>

          <motion.p
            className="text-lg md:text-xl text-white/70 tracking-wide mb-12"
            variants={itemVariants}
          >
            The automated information hound.
          </motion.p>

          <motion.button
            className="pointer-events-auto px-8 py-4 rounded-full text-white font-medium
              backdrop-blur-xl bg-white/10 border border-white/20
              hover:bg-white/20 hover:border-white/30
              transition-all duration-300
              shadow-[0_0_30px_oklch(0.7_0.3_300_/0.3)]"
            variants={itemVariants}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onEnter}
          >
            Wake it up
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

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

    const handleMouseLeave = () => {
      setTransform({ rotateX: 0, rotateY: 0 });
    };

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
      style={{
        perspective: "1000px",
      }}
    >
      <div
        className="absolute inset-0 transition-transform duration-200 ease-out"
        style={{
          transform: `rotateX(${transform.rotateX}deg) rotateY(${transform.rotateY}deg)`,
          background: `
            radial-gradient(ellipse at 30% 20%, oklch(0.25 0.1 280 / 0.4) 0%, transparent 50%),
            radial-gradient(ellipse at 70% 80%, oklch(0.2 0.08 300 / 0.3) 0%, transparent 50%),
            radial-gradient(circle at center, oklch(0.15 0.05 280) 0%, oklch(0.08 0.03 290) 100%)
          `,
        }}
      />
    </div>
  );
}

export function HeroStage({ onEnter }: { onEnter?: () => void }) {
  const [curtainOpen, setCurtainOpen] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [isSkipped, setIsSkipped] = useState(true);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const played = sessionStorage.getItem("cyber_intro_played");
    if (!played) {
      setIsSkipped(false);
    } else {
      setShowCredits(true);
    }
  }, []);

  useEffect(() => {
    if (isSkipped) {
      setShowCredits(true);
      return;
    }

    if (curtainOpen) {
      const timer = setTimeout(() => {
        setShowCredits(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [curtainOpen, isSkipped]);

  const handleSkip = useCallback(() => {
    setIsSkipped(true);
    setCurtainOpen(true);
    sessionStorage.setItem("cyber_intro_played", "true");
  }, []);

  const handleEnterClick = useCallback(() => {
    sessionStorage.setItem("cyber_intro_played", "true");
    onEnter?.();
  }, [onEnter]);

  const handleDogLanded = useCallback(() => {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }, []);

  return (
    <motion.div
      className="fixed inset-0 w-full h-full overflow-hidden"
      animate={shake ? { y: [0, 10, -5, 0] } : { y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <TiltBackground />

      {!isSkipped && (
        <CurtainSection
          onCurtainOpen={() => setCurtainOpen(true)}
          onDogLanded={handleDogLanded}
        />
      )}

      <CreditsSection show={showCredits} onEnter={handleEnterClick} />

      {!isSkipped && (
        <motion.button
          className="absolute top-6 right-6 z-50 px-4 py-2 text-sm text-white/50 
            backdrop-blur-md bg-black/20 rounded-full border border-white/10
            hover:text-white/80 hover:bg-black/30 transition-colors"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2 }}
          onClick={handleSkip}
        >
          Skip Intro
        </motion.button>
      )}
    </motion.div>
  );
}
