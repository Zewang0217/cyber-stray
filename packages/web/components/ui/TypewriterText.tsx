"use client";

import { useEffect, useState } from "react";

interface TypewriterTextProps {
  text: string;
  speed?: number;
  onComplete?: () => void;
}

/**
 * 打字机效果文字
 * 模拟终端文字逐字出现，带光标闪烁
 */
export function TypewriterText({
  text,
  speed = 30,
  onComplete,
}: TypewriterTextProps): React.ReactElement {
  const [displayedText, setDisplayedText] = useState("");
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    setDisplayedText("");
    setIsComplete(false);

    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1));
        currentIndex += 1;
      } else {
        clearInterval(interval);
        setIsComplete(true);
        onComplete?.();
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed, onComplete]);

  return (
    <span className="inline">
      {displayedText}
      {!isComplete && (
        <span
          className="inline-block w-[2px] h-[1em] bg-accent ml-0.5 align-middle"
          style={{ animation: "cursor-blink 1s step-end infinite" }}
        />
      )}
    </span>
  );
}
