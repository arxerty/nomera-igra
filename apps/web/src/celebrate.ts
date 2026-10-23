import confetti from 'canvas-confetti';
import { TIER_COLORS, TIER_RANK, type Tier } from '@nomer/shared';
import { haptic } from './telegram';
import { sound } from './sound';

/** Эффект выпадения: обычный — короткий звук, эпик и выше — конфетти, фанфары и сильная вибрация. */
export function celebrate(tier: Tier) {
  const rank = TIER_RANK[tier];
  if (rank < TIER_RANK.epic) {
    sound.reveal();
    haptic.notify(rank >= TIER_RANK.rare ? 'success' : 'warning');
    return;
  }

  sound.fanfare();
  haptic.notify('success');
  [0, 120, 240, 420].forEach((ms) => setTimeout(() => haptic.impact('heavy'), ms));

  const colors = [TIER_COLORS[tier], '#ffffff', TIER_COLORS.legendary];
  const particleCount = rank >= TIER_RANK.mythic ? 220 : rank >= TIER_RANK.legendary ? 160 : 100;
  void confetti({ particleCount, spread: 80, startVelocity: 48, origin: { y: 0.35 }, colors });
  if (rank >= TIER_RANK.legendary) {
    setTimeout(() => {
      void confetti({ particleCount: 80, angle: 60, spread: 60, origin: { x: 0, y: 0.6 }, colors });
      void confetti({ particleCount: 80, angle: 120, spread: 60, origin: { x: 1, y: 0.6 }, colors });
    }, 350);
  }
}
