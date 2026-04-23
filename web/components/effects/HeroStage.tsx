"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useSpring } from "framer-motion";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

// Preload the GLB model
useGLTF.preload("/low_poly_dog.glb");

// ==================== Phase 2: The Actor - 3D Dog Model ====================
function DogModel() {
  const { scene } = useGLTF("/low_poly_dog.glb");
  const modelRef = useRef<THREE.Group>(null);

  // Clone the scene to avoid mutations
  const clonedScene = scene.clone();

  useEffect(() => {
    if (modelRef.current) {
      const box = new THREE.Box3().setFromObject(modelRef.current);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 2 / maxDim;
      modelRef.current.scale.setScalar(scale);
      modelRef.current.position.sub(center.multiplyScalar(scale));
    }
  }, []);

  useFrame((state) => {
    if (modelRef.current) {
      // Subtle idle rotation
      modelRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
    }
  });

  return (
    <group ref={modelRef}>
      <primitive object={clonedScene} />
    </group>
  );
}

// ==================== Phase 1 & 2: Curtain & Dog Container ====================
function CurtainSection({ onCurtainOpen }: { onCurtainOpen: () => void }) {
  const [showDog, setShowDog] = useState(false);
  const [dogLanded, setDogLanded] = useState(false);

  // Spring animation for dog drop - starts at -200vh and drops to 0
  const dogY = useSpring("-200%", {
    stiffness: 200,
    damping: 10,
    mass: 1,
  });

  useEffect(() => {
    // Show dog when curtain is mostly open
    const dogTimer = setTimeout(() => {
      setShowDog(true);
      // Animate dog falling
      dogY.set("0%");
      onCurtainOpen();
    }, 1200);

    // Trigger land effect after dog lands
    const landTimer = setTimeout(() => {
      setDogLanded(true);
    }, 2000);

    return () => {
      clearTimeout(dogTimer);
      clearTimeout(landTimer);
    };
  }, [dogY, onCurtainOpen]);

  return (
    <div className="absolute inset-0 z-10">
      {/* Upper Curtain */}
      <motion.div
        className="absolute top-0 left-0 right-0 h-1/2 bg-black z-20"
        initial={{ y: 0 }}
        animate={{ y: "-100%" }}
        transition={{
          delay: 0.5,
          duration: 1.2,
          type: "spring",
          stiffness: 100,
          damping: 20,
          mass: 1,
        }}
      />

      {/* Lower Curtain */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 h-1/2 bg-black z-20"
        initial={{ y: 0 }}
        animate={{ y: "100%" }}
        transition={{
          delay: 0.5,
          duration: 1.2,
          type: "spring",
          stiffness: 100,
          damping: 20,
          mass: 1,
        }}
      />

      {/* Dog Container - Falls from above with spring physics */}
      <AnimatePresence>
        {showDog && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center z-[15]"
            style={{ y: dogY }}
            onLayoutAnimationComplete={() => {
              // Alternative landing detection
            }}
          >
            <div className="w-64 h-64 md:w-80 md:h-80">
              <Canvas camera={{ position: [0, 0, 5], fov: 50 }}>
                <ambientLight intensity={0.8} />
                <directionalLight position={[5, 5, 5]} intensity={1} />
                <pointLight position={[-5, -5, -5]} intensity={0.5} color="#8b5cf6" />
                <DogModel />
              </Canvas>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Impact Glow Effect - Neon Purple */}
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

// ==================== Phase 3: The Credits ====================
function CreditsSection({ show, onEnter }: { show: boolean; onEnter?: () => void }) {
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
          {/* Main Title */}
          <motion.h1
            className="font-[family-name:var(--font-space-grotesk)] text-6xl md:text-8xl font-bold text-white tracking-tight mb-4"
            variants={itemVariants}
            style={{
              textShadow: "0 0 40px oklch(0.7 0.3 300 / 0.5)",
            }}
          >
            CYBER STRAY
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            className="text-lg md:text-xl text-white/70 tracking-wide mb-12"
            variants={itemVariants}
          >
            The automated information hound.
          </motion.p>

          {/* CTA Button - Glassmorphism */}
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

// ==================== Phase 4: 3D Tilt Background ====================
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

      // Max rotation: 3 degrees
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

// ==================== Main HeroStage Component ====================
export function HeroStage({ onEnter }: { onEnter?: () => void }) {
  const [curtainOpen, setCurtainOpen] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [isSkipped, setIsSkipped] = useState(false);

  useEffect(() => {
    if (isSkipped) {
      setShowCredits(true);
      return;
    }

    if (curtainOpen) {
      // Show credits 1.5s after curtain opens (dog has landed)
      const timer = setTimeout(() => {
        setShowCredits(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [curtainOpen, isSkipped]);

  const handleSkip = () => {
    setIsSkipped(true);
    setCurtainOpen(true);
  };

  return (
    <div className="fixed inset-0 w-full h-full overflow-hidden">
      {/* 3D Tilt Background */}
      <TiltBackground />

      {/* Curtain & Dog Section */}
      {!isSkipped && <CurtainSection onCurtainOpen={() => setCurtainOpen(true)} />}

      {/* Credits Section */}
      <CreditsSection show={showCredits} onEnter={onEnter} />

      {/* Skip Animation Button */}
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
    </div>
  );
}
