import { memo, useId } from 'react';
import type { CarArchetype, CarTuning } from '@nomer/shared';

/**
 * Машина в профиль (смотрит вправо), рисуется по типажу модели и тюнингу.
 * Всё — векторное SVG, поэтому внешний вид меняется мгновенно при выборе тюнинга.
 */

type Shape = 'classic' | 'sedan' | 'suv' | 'sport' | 'boxy' | 'limo';

const SHAPE_BY_ARCHETYPE: Record<CarArchetype, Shape> = {
  soviet_classic: 'classic',
  people_sedan: 'sedan',
  comfort_sedan: 'sedan',
  business_sedan: 'sedan',
  crossover: 'suv',
  german_crossover: 'suv',
  sports_car: 'sport',
  offroad_gelik: 'boxy',
  limousine: 'limo',
};

interface ShapeDef {
  body: string;
  windows: string;
  /** x центров колёс: заднее, переднее. */
  wheels: [number, number];
  wheelR: number;
  /** Нижняя кромка кузова — для обвеса и подсветки. */
  sill: number;
  /** Фары: [x, y] передней и задней. */
  head: [number, number];
  tail: [number, number];
  /** Точка крепления спойлера на багажнике. */
  spoiler: [number, number];
  pillar: number;
}

const SHAPES: Record<Shape, ShapeDef> = {
  classic: {
    body: 'M32 106 L32 82 L46 76 L104 73 L124 46 L214 46 L240 72 L316 76 L330 83 L330 106 Z',
    windows: 'M112 72 L129 51 L168 51 L168 72 Z M174 72 L174 51 L210 51 L230 72 Z',
    wheels: [86, 272],
    wheelR: 19,
    sill: 106,
    head: [324, 86],
    tail: [36, 86],
    spoiler: [52, 74],
    pillar: 171,
  },
  sedan: {
    body: 'M30 106 L28 86 Q30 73 50 71 L104 66 Q130 42 162 40 L214 40 Q240 42 264 64 L318 72 Q336 76 336 92 L334 106 Z',
    windows: 'M116 66 Q138 47 162 46 L184 46 L184 66 Z M190 66 L190 46 L212 46 Q232 48 250 66 Z',
    wheels: [88, 272],
    wheelR: 20,
    sill: 106,
    head: [328, 84],
    tail: [33, 84],
    spoiler: [56, 70],
    pillar: 187,
  },
  suv: {
    body: 'M28 102 L26 70 Q28 57 46 55 L92 51 Q112 29 142 27 L230 27 Q254 29 272 51 L320 59 Q337 63 337 82 L335 102 Z',
    windows: 'M102 52 Q118 33 142 32 L180 32 L180 52 Z M186 52 L186 32 L228 32 Q248 34 260 52 Z',
    wheels: [88, 274],
    wheelR: 22,
    sill: 102,
    head: [330, 72],
    tail: [30, 72],
    spoiler: [70, 30],
    pillar: 183,
  },
  sport: {
    body: 'M26 106 L26 90 Q30 79 60 77 L120 71 Q160 47 200 46 L232 48 Q264 56 294 72 L330 80 Q341 86 339 99 L335 106 Z',
    windows: 'M134 70 Q164 52 198 51 L206 51 L210 70 Z M216 70 L214 52 L230 53 Q252 59 268 70 Z',
    wheels: [86, 276],
    wheelR: 19,
    sill: 106,
    head: [330, 88],
    tail: [30, 92],
    spoiler: [42, 80],
    pillar: 212,
  },
  boxy: {
    body: 'M30 102 L30 50 L68 46 L80 25 L240 25 L262 50 L326 54 L333 62 L333 102 Z',
    windows: 'M88 46 L96 31 L154 31 L154 46 Z M160 46 L160 31 L236 31 L250 46 Z',
    wheels: [92, 272],
    wheelR: 23,
    sill: 102,
    head: [328, 64],
    tail: [33, 64],
    spoiler: [70, 25],
    pillar: 157,
  },
  limo: {
    body: 'M16 106 L15 86 Q17 73 37 71 L88 66 Q110 43 140 41 L246 41 Q270 43 288 64 L332 72 Q346 76 346 92 L344 106 Z',
    windows: 'M98 66 Q118 47 140 46 L180 46 L180 66 Z M186 66 L186 46 L226 46 L226 66 Z M232 66 L232 46 L244 46 Q262 48 276 66 Z',
    wheels: [66, 296],
    wheelR: 20,
    sill: 106,
    head: [338, 84],
    tail: [19, 84],
    spoiler: [40, 70],
    pillar: 183,
  },
};

/** Поворот тона цвета — второй цвет «хамелеона». */
function shiftHue(hex: string, deg: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) / 255;
  let g = ((n >> 8) & 255) / 255;
  let b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + deg + 360) % 360;
  // Для серых цветов хамелеон всё равно должен переливаться.
  const sat = Math.max(s, 0.55);
  const lig = Math.min(Math.max(l, 0.35), 0.6);
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lig - c / 2;
  [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

const TINT = ['#bcd7ee', '#7f9bb5', '#4b5d70', '#232c37', '#141a21', '#0b0f14'];
const RIMS: { color: string; spokes: number; dish?: boolean }[] = [
  { color: '#9aa1ab', spokes: 0 },
  { color: '#c9ced6', spokes: 5 },
  { color: '#dfe3e8', spokes: 10 },
  { color: '#b8bec6', spokes: 16 },
  { color: '#eef1f4', spokes: 6, dish: true },
  { color: '#2a2f36', spokes: 5 },
  { color: '#d4af37', spokes: 7 },
];

function Wheel({ cx, cy, r, style, id }: { cx: number; cy: number; r: number; style: number; id: string }) {
  const rim = RIMS[style % RIMS.length]!;
  const rimR = r * 0.62;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 3} fill="#14171b" />
      <circle cx={cx} cy={cy} r={r} fill="#24282e" />
      <circle cx={cx} cy={cy} r={rimR} fill={rim.dish ? `url(#${id}-chrome)` : rim.color} />
      {rim.spokes === 0 ? (
        [0, 90, 180, 270].map((a) => (
          <circle
            key={a}
            cx={cx + Math.cos((a * Math.PI) / 180) * rimR * 0.55}
            cy={cy + Math.sin((a * Math.PI) / 180) * rimR * 0.55}
            r={rimR * 0.13}
            fill="#5d636b"
          />
        ))
      ) : (
        <g stroke={style === 5 ? '#4a5058' : '#7d848d'} strokeWidth={rim.spokes > 8 ? 1.1 : 2.4} strokeLinecap="round">
          {Array.from({ length: rim.spokes }, (_, i) => {
            const a = (i / rim.spokes) * Math.PI * 2;
            return (
              <line
                key={i}
                x1={cx + Math.cos(a) * rimR * 0.25}
                y1={cy + Math.sin(a) * rimR * 0.25}
                x2={cx + Math.cos(a) * rimR * 0.92}
                y2={cy + Math.sin(a) * rimR * 0.92}
              />
            );
          })}
        </g>
      )}
      <circle cx={cx} cy={cy} r={rimR * 0.2} fill="#3a3f46" />
    </g>
  );
}

export interface CarViewProps {
  archetype: CarArchetype;
  tuning: CarTuning;
  /** Цвета эксклюзивных окрасок по id (из конфига). */
  exclusiveColors?: Record<string, string[]>;
  /** Колёса крутятся (гонка). */
  spinning?: boolean;
  className?: string;
}

export const CarView = memo(function CarView({ archetype, tuning, exclusiveColors, spinning, className }: CarViewProps) {
  const id = useId().replace(/:/g, '');
  const shape = SHAPES[SHAPE_BY_ARCHETYPE[archetype]];
  const { paint } = tuning;
  const exclusive = paint.finish === 'exclusive' ? (exclusiveColors?.[paint.color] ?? ['#d4af37', '#8a6d1e']) : null;
  const base = exclusive ? exclusive[0]! : paint.color;
  const second = exclusive?.[1] ?? (paint.finish === 'chameleon' ? shiftHue(base, 140) : base);
  const [rear, front] = shape.wheels;
  const groundY = shape.sill + 6;
  const wheelY = groundY - shape.wheelR;

  return (
    <svg className={className} viewBox="0 0 360 150" role="img" style={{ display: 'block', width: '100%', height: 'auto' }}>
      <defs>
        <linearGradient id={`${id}-paint`} x1="0" y1="0" x2={paint.finish === 'chameleon' || exclusive ? '1' : '0'} y2="1">
          <stop offset="0" stopColor={base} />
          <stop offset="1" stopColor={second} />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
          {paint.finish === 'matte' ? (
            <>
              <stop offset="0" stopColor="#fff" stopOpacity="0.06" />
              <stop offset="1" stopColor="#000" stopOpacity="0.12" />
            </>
          ) : paint.finish === 'metallic' || paint.finish === 'exclusive' ? (
            <>
              <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
              <stop offset="0.35" stopColor="#fff" stopOpacity="0.08" />
              <stop offset="0.55" stopColor="#fff" stopOpacity="0.3" />
              <stop offset="1" stopColor="#000" stopOpacity="0.3" />
            </>
          ) : paint.finish === 'pearl' ? (
            <>
              <stop offset="0" stopColor="#fff6fb" stopOpacity="0.7" />
              <stop offset="0.5" stopColor="#e9f3ff" stopOpacity="0.25" />
              <stop offset="1" stopColor="#000" stopOpacity="0.18" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#fff" stopOpacity="0.4" />
              <stop offset="0.45" stopColor="#fff" stopOpacity="0.05" />
              <stop offset="1" stopColor="#000" stopOpacity="0.22" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`${id}-chrome`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#9da4ad" />
          <stop offset="1" stopColor="#f2f4f6" />
        </linearGradient>
        <filter id={`${id}-blur`} x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* Тень и подсветка днища */}
      <ellipse cx={(rear + front) / 2} cy={groundY + 2} rx={(front - rear) / 2 + 60} ry={5} fill="#000" opacity={0.18} />
      {tuning.underglow && (
        <ellipse
          cx={(rear + front) / 2}
          cy={groundY}
          rx={(front - rear) / 2 + 40}
          ry={7}
          fill={tuning.underglow}
          opacity={0.85}
          filter={`url(#${id}-blur)`}
        />
      )}

      {/* Кузов: цвет + блики отделки */}
      <path d={shape.body} fill={`url(#${id}-paint)`} stroke="rgba(0,0,0,0.35)" strokeWidth="1.2" strokeLinejoin="round" />
      <path d={shape.body} fill={`url(#${id}-shine)`} />
      {paint.finish === 'pearl' && <path d={shape.body} fill="#fff" opacity={0.08} />}

      {/* Окна и тонировка */}
      <path d={shape.windows} fill={TINT[Math.min(tuning.tint, TINT.length - 1)]} stroke="rgba(0,0,0,0.35)" strokeWidth="1" />
      {tuning.tint < 2 && <path d={shape.windows} fill="#fff" opacity={0.18} />}

      {/* Линия двери и ручка */}
      <line x1={shape.pillar} y1={shape.sill - 42} x2={shape.pillar} y2={shape.sill - 8} stroke="rgba(0,0,0,0.25)" strokeWidth="1.2" />
      <rect x={shape.pillar + 10} y={shape.sill - 34} width={12} height={3} rx={1.5} fill="rgba(0,0,0,0.35)" />

      {/* Фары */}
      <ellipse cx={shape.head[0]} cy={shape.head[1]} rx={6} ry={4} fill="#fff8d6" stroke="rgba(0,0,0,0.3)" />
      <rect x={shape.tail[0] - 3} y={shape.tail[1] - 4} width={7} height={8} rx={2} fill="#d8323c" />

      {/* Обвес: пороги и губа; на 2 и 4 — антикрыло */}
      {tuning.bodykit > 0 && (
        <path
          d={`M${rear - 30} ${shape.sill - 1} L${front + 36} ${shape.sill - 1} L${front + 30} ${shape.sill + 4} L${rear - 26} ${shape.sill + 4} Z`}
          fill="#1d2228"
        />
      )}
      {(tuning.bodykit === 2 || tuning.bodykit === 4) && (
        <g fill="#1d2228">
          <rect x={shape.spoiler[0] - 6} y={shape.spoiler[1] - (tuning.bodykit === 4 ? 16 : 9)} width={tuning.bodykit === 4 ? 46 : 34} height={4} rx={2} />
          <rect x={shape.spoiler[0] + 4} y={shape.spoiler[1] - (tuning.bodykit === 4 ? 13 : 6)} width={3} height={tuning.bodykit === 4 ? 13 : 6} />
          <rect x={shape.spoiler[0] + 24} y={shape.spoiler[1] - (tuning.bodykit === 4 ? 13 : 6)} width={3} height={tuning.bodykit === 4 ? 13 : 6} />
        </g>
      )}

      {/* Колёса */}
      {[rear, front].map((cx) => (
        <g key={cx}>
          <g style={spinning ? { transformOrigin: `${cx}px ${wheelY}px`, animation: 'wheel-spin 0.25s linear infinite' } : undefined}>
            <Wheel cx={cx} cy={wheelY} r={shape.wheelR} style={tuning.wheels} id={id} />
          </g>
        </g>
      ))}
    </svg>
  );
});
