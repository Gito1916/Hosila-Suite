import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface HoverTipProps {
  text?: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delayMs?: number;
  className?: string;
}

export function HoverTip({
  text,
  children,
  position = 'top',
  delayMs = 2000,
  className = 'inline-flex',
}: HoverTipProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placement: 'top' | 'bottom' | 'left' | 'right' } | null>(
    null
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setVisible(false);
  }, [clearTimer]);

  const computePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    const estWidth = 236;
    const estHeight = 64;
    let placement = position;

    if (placement === 'top' && rect.top < estHeight + gap + 8) {
      placement = 'bottom';
    } else if (placement === 'bottom' && window.innerHeight - rect.bottom < estHeight + gap + 8) {
      placement = 'top';
    } else if (placement === 'right' && window.innerWidth - rect.right < estWidth + gap + 8) {
      placement = 'left';
    } else if (placement === 'left' && rect.left < estWidth + gap + 8) {
      placement = 'right';
    }

    let top = 0;
    let left = 0;
    if (placement === 'top') {
      top = rect.top - gap;
      left = rect.left + rect.width / 2;
      left = Math.max(estWidth / 2 + 12, Math.min(window.innerWidth - estWidth / 2 - 12, left));
    } else if (placement === 'bottom') {
      top = rect.bottom + gap;
      left = rect.left + rect.width / 2;
      left = Math.max(estWidth / 2 + 12, Math.min(window.innerWidth - estWidth / 2 - 12, left));
    } else if (placement === 'right') {
      top = rect.top + rect.height / 2;
      left = rect.right + gap;
      top = Math.max(36, Math.min(window.innerHeight - 36, top));
    } else {
      top = rect.top + rect.height / 2;
      left = rect.left - gap;
      top = Math.max(36, Math.min(window.innerHeight - 36, top));
    }

    return { top, left, placement };
  }, [position]);

  const scheduleShow = useCallback(() => {
    if (!text?.trim()) return;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      const next = computePosition();
      if (next) {
        setCoords(next);
        setVisible(true);
      }
    }, delayMs);
  }, [clearTimer, computePosition, delayMs, text]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  useEffect(() => {
    if (!visible) return;
    const onScrollOrResize = () => hide();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [visible, hide]);

  const transformStyle =
    coords?.placement === 'top'
      ? 'translate(-50%, -100%)'
      : coords?.placement === 'bottom'
      ? 'translate(-50%, 0%)'
      : coords?.placement === 'right'
      ? 'translate(0%, -50%)'
      : 'translate(-100%, -50%)';

  return (
    <>
      <span
        ref={triggerRef}
        className={className}
        onMouseEnter={scheduleShow}
        onMouseLeave={hide}
        onMouseDown={hide}
        onBlur={hide}
      >
        {children}
      </span>
      {visible &&
        coords &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              transform: transformStyle,
              zIndex: 9999,
            }}
            className="pointer-events-none max-w-[248px] rounded-xl border border-ink/15 bg-surface px-3 py-2 text-[11.5px] font-normal leading-relaxed text-ink shadow-[0_10px_28px_rgba(29,29,31,0.14)] dark:shadow-[0_14px_36px_rgba(0,0,0,0.55)]"
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
}
