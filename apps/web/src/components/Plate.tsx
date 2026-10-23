import { memo, useMemo, type CSSProperties } from 'react';
import {
  PLATE_HEIGHT,
  PLATE_WIDTH,
  TIER_COLORS,
  formatPlate,
  isSpecialTier,
  plateCharsInnerSvg,
  plateInnerSvg,
  type Plate as PlateValue,
  type Tier,
} from '@nomer/shared';

function PlateSvg({ inner, label }: { inner: string; label: string }) {
  return (
    <svg viewBox={`0 0 ${PLATE_WIDTH} ${PLATE_HEIGHT}`} role="img" aria-label={label}>
      <g dangerouslySetInnerHTML={{ __html: inner }} />
    </svg>
  );
}

/** Табличка номера. Эпик и выше по умолчанию подсвечиваются цветом редкости. */
export const Plate = memo(function Plate(props: {
  plate: PlateValue;
  tier?: Tier;
  glow?: boolean;
  style?: CSSProperties;
}) {
  const { plate, tier, glow } = props;
  const inner = useMemo(() => plateInnerSvg(plate), [plate]);
  const showGlow = glow ?? (tier ? isSpecialTier(tier) : false);
  return (
    <div
      className={`plate-wrap${showGlow ? ' plate-glow' : ''}`}
      style={{ ...props.style, ['--glow' as string]: tier ? TIER_COLORS[tier] : undefined }}
    >
      <PlateSvg inner={inner} label={formatPlate(plate)} />
    </div>
  );
});

/**
 * Табличка-маска: 6 символов основной части и 2–3 региона, `*` — звёздочка.
 * Для VIP-серий («А***МР») и превью поиска на рынке.
 */
export const MaskPlate = memo(function MaskPlate({ body, region = '**' }: { body: string; region?: string }) {
  const chars = useMemo(() => {
    const main = [...body.padEnd(6, '*')].slice(0, 6);
    return [...main, ...[...region.padEnd(2, '*')].slice(0, 3)];
  }, [body, region]);
  const inner = useMemo(() => plateCharsInnerSvg(chars), [chars]);
  return (
    <div className="plate-wrap">
      <PlateSvg inner={inner} label={`${body} ${region}`} />
    </div>
  );
});
