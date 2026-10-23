import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  GLYPH_STROKE,
  PLATE_COLORS,
  PLATE_HEIGHT,
  PLATE_LETTERS,
  PLATE_WIDTH,
  TIER_COLORS,
  glyphPath,
  plateChars,
  plateFrameSvg,
  plateSlots,
  type Plate,
  type PlateSlot,
  type Tier,
} from '@nomer/shared';

const FRAME = plateFrameSvg();
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
/** Шаг ленты барабана: равен высоте таблички, чтобы соседние символы не попадали в окно. */
const CELL = PLATE_HEIGHT;
const LOOP = 8;
/** Задержка первой остановки и шаг между остановками, мс. */
const FIRST_STOP_MS = 350;
const STOP_STEP_MS = 230;
const SETTLE_MS = 480;

type Mode = 'static' | 'spin' | 'settle';

const strokeProps = {
  fill: 'none',
  stroke: PLATE_COLORS.ink,
  strokeWidth: GLYPH_STROKE,
  strokeLinecap: 'butt' as const,
  strokeLinejoin: 'round' as const,
};

function randomChars(alphabet: readonly string[], n: number): string[] {
  return Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]!);
}

function Reel(props: { slot: PlateSlot; char: string; mode: Mode; clipId: string; onSettled: () => void }) {
  const { slot, char, mode, clipId } = props;
  const alphabet = slot.kind === 'letter' ? PLATE_LETTERS : DIGITS;
  const loopChars = useMemo(() => {
    const c = randomChars(alphabet, LOOP);
    return [...c, c[0]!];
  }, [alphabet]);
  const settleChars = useMemo(() => [...randomChars(alphabet, 5), char], [alphabet, char]);

  const ref = useRef<SVGGElement>(null);
  const onSettled = useRef(props.onSettled);
  onSettled.current = props.onSettled;

  useLayoutEffect(() => {
    if (mode !== 'settle' || !ref.current) return;
    const distance = (settleChars.length - 1) * CELL;
    const anim = ref.current.animate(
      [{ transform: 'translateY(0px)' }, { transform: `translateY(${-distance}px)` }],
      { duration: SETTLE_MS, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.12)', fill: 'forwards' },
    );
    anim.onfinish = () => onSettled.current();
    return () => anim.cancel();
  }, [mode, settleChars]);

  const chars = mode === 'spin' ? loopChars : mode === 'settle' ? settleChars : [char];
  const d = chars.map((ch, k) => glyphPath(ch, { ...slot, y: slot.y + k * CELL })).join(' ');
  const spinStyle =
    mode === 'spin'
      ? {
          ['--dist' as string]: `${-LOOP * CELL}px`,
          animation: `reel-loop ${0.26 + (slot.index % 3) * 0.04}s linear infinite`,
        }
      : undefined;

  return (
    <g clipPath={`url(#${clipId})`}>
      <g ref={ref} style={spinStyle} filter={mode === 'spin' ? 'url(#reel-blur)' : undefined}>
        <path d={d} {...strokeProps} />
      </g>
    </g>
  );
}

/**
 * Табличка-«слот-машина». Пока `spinning` и нет `result`, барабаны крутятся.
 * Когда приходит результат с сервера, барабаны останавливаются по очереди слева
 * направо; на каждой остановке вызывается onReelStop (хаптик и щелчок).
 */
export function SlotPlate(props: {
  result: Plate | null;
  spinning: boolean;
  fallback: Plate | null;
  tier?: Tier | null;
  glow?: boolean;
  onReelStop?: (index: number, total: number) => void;
  onDone?: () => void;
}) {
  const { result, spinning, fallback, tier, glow } = props;
  const display = result ?? fallback;
  const regionLen = display?.region.length ?? 2;
  const slots = useMemo(() => plateSlots(regionLen), [regionLen]);
  const chars = useMemo(() => (display ? plateChars(display) : slots.map(() => '')), [display, slots]);
  const [modes, setModes] = useState<Mode[]>(() => slots.map(() => 'static'));
  const settled = useRef(0);
  const baseId = useId().replace(/:/g, '');

  const callbacks = useRef(props);
  callbacks.current = props;

  // Старт вращения: все барабаны крутятся, пока ждём ответ сервера.
  useEffect(() => {
    if (spinning && !result) {
      settled.current = 0;
      setModes(slots.map(() => 'spin'));
    }
  }, [spinning, result, slots]);

  // Пришёл результат: останавливаем барабаны слева направо.
  useEffect(() => {
    if (!spinning || !result) return;
    settled.current = 0;
    setModes(slots.map(() => 'spin'));
    const timers = slots.map((_, i) =>
      setTimeout(() => setModes((m) => m.map((x, j) => (j === i ? 'settle' : x))), FIRST_STOP_MS + i * STOP_STEP_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [spinning, result, slots]);

  const handleSettled = (i: number) => {
    callbacks.current.onReelStop?.(i, slots.length);
    settled.current += 1;
    if (settled.current === slots.length) {
      setModes(slots.map(() => 'static'));
      callbacks.current.onDone?.();
    }
  };

  const showGlow = glow && tier;
  return (
    <div
      className={`plate-wrap${showGlow ? ' plate-glow' : ''}`}
      style={{ ['--glow' as string]: tier ? TIER_COLORS[tier] : undefined }}
    >
      <svg viewBox={`0 0 ${PLATE_WIDTH} ${PLATE_HEIGHT}`}>
        <defs>
          <filter id="reel-blur" x="-10%" y="-50%" width="120%" height="200%">
            <feGaussianBlur stdDeviation="0 5" />
          </filter>
          {slots.map((s) => (
            <clipPath key={s.index} id={`${baseId}-clip-${s.index}`}>
              <rect x={s.clip.x} y={s.clip.y} width={s.clip.w} height={s.clip.h} />
            </clipPath>
          ))}
        </defs>
        <g dangerouslySetInnerHTML={{ __html: FRAME }} />
        {slots.map((s) => (
          <Reel
            key={`${regionLen}-${s.index}`}
            slot={s}
            char={chars[s.index] ?? ''}
            mode={modes[s.index] ?? 'spin'}
            clipId={`${baseId}-clip-${s.index}`}
            onSettled={() => handleSettled(s.index)}
          />
        ))}
      </svg>
    </div>
  );
}
