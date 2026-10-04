"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "../lib/i18n";

type Props = {
  /** Left side of the heading row (eyebrow + title). */
  header: ReactNode;
  /** Shown to the left of the arrow buttons, e.g. a DEMO DATA / DEVNET badge. */
  badge?: ReactNode;
  /** Class of the heading row. Defaults to the page section heading. */
  headClassName?: string;
  /** Rendered between the heading row and the track. */
  intro?: ReactNode;
  /** Rendered instead of the track (loading / empty states). The arrows are hidden. */
  placeholder?: ReactNode;
  /** Accessible name of the scrolling region. */
  label: string;
  children?: ReactNode;
};

/**
 * One horizontally scrolling row (CSS scroll-snap, native swipe on touch) with previous/next buttons in the
 * heading row. Children are the cards; give them their own width in CSS. No dependency, no vertical wrapping.
 */
export function Carousel({ header, badge, headClassName = "sectionTitle", intro, placeholder, label, children }: Props) {
  const { t } = useI18n();
  const trackRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const hasPlaceholder = Boolean(placeholder);

  const update = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const next = { start: el.scrollLeft <= 1, end: el.scrollLeft >= el.scrollWidth - el.clientWidth - 1 };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    update();
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const mutation = new MutationObserver(update);
    mutation.observe(el, { childList: true });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [update, hasPlaceholder]);

  function go(direction: 1 | -1) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.8, 200), behavior: "smooth" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    }
  }

  const scrollable = !(edges.start && edges.end);

  return (
    <div className="carousel">
      <div className={headClassName}>
        {header}
        <div className="carouselTools">
          {badge}
          {!hasPlaceholder && (
            <div className="carouselButtons" style={scrollable ? undefined : { visibility: "hidden" }}>
              <button type="button" className="carouselBtn" aria-label={t({ en: "Scroll left", ja: "左へスクロール" })} disabled={edges.start} onClick={() => go(-1)}>←</button>
              <button type="button" className="carouselBtn" aria-label={t({ en: "Scroll right", ja: "右へスクロール" })} disabled={edges.end} onClick={() => go(1)}>→</button>
            </div>
          )}
        </div>
      </div>
      {intro}
      {hasPlaceholder ? (
        placeholder
      ) : (
        <div className="carouselTrack" ref={trackRef} tabIndex={0} role="region" aria-label={label} onScroll={update} onKeyDown={onKeyDown}>
          {children}
        </div>
      )}
    </div>
  );
}
