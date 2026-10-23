-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic');

-- CreateEnum
CREATE TYPE "AcquireVia" AS ENUM ('roll', 'market', 'trade');

-- CreateEnum
CREATE TYPE "ReleaseVia" AS ENUM ('system_sell', 'market', 'trade');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('active', 'sold', 'cancelled');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('pending', 'accepted', 'declined', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('offered', 'requested');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('chips', 'rolls');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('starting_bonus', 'roll_spend', 'roll_purchase', 'stars_purchase', 'daily_bonus', 'quest_reward', 'referral_reward', 'system_sell', 'market_buy', 'market_sale', 'trade', 'admin_adjust');

-- CreateEnum
CREATE TYPE "RollSource" AS ENUM ('free', 'balance');

-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('system_sell', 'market_sale', 'trade');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'refunded');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "photoUrl" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "hapticsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "botBlocked" BOOLEAN NOT NULL DEFAULT false,
    "chips" INTEGER NOT NULL DEFAULT 0,
    "rolls" INTEGER NOT NULL DEFAULT 0,
    "lastFreeRollAt" TIMESTAMP(3),
    "streakDay" INTEGER NOT NULL DEFAULT 0,
    "lastDailyClaim" TEXT,
    "totalRolls" INTEGER NOT NULL DEFAULT 0,
    "referredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "letters" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "region" TEXT NOT NULL,
    "tier" "Tier" NOT NULL,
    "value" INTEGER NOT NULL,
    "traits" TEXT[],
    "bonuses" TEXT[],
    "ownerId" TEXT,
    "acquiredAt" TIMESTAMP(3),
    "firstRolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rolledTimes" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Plate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlateOwnership" (
    "id" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acquiredVia" "AcquireVia" NOT NULL,
    "acquiredPrice" INTEGER,
    "releasedAt" TIMESTAMP(3),
    "releasedVia" "ReleaseVia",
    "releasedPrice" INTEGER,

    CONSTRAINT "PlateOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'active',
    "activePlateId" TEXT,
    "buyerId" TEXT,
    "fee" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeOffer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT,
    "offeredChips" INTEGER NOT NULL DEFAULT 0,
    "requestedChips" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "status" "TradeStatus" NOT NULL DEFAULT 'pending',
    "acceptedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "TradeOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeItem" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,

    CONSTRAINT "TradeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "refId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RollLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "plateKey" TEXT NOT NULL,
    "rolledTier" "Tier" NOT NULL,
    "tier" "Tier" NOT NULL,
    "value" INTEGER NOT NULL,
    "source" "RollSource" NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RollLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealLog" (
    "id" TEXT NOT NULL,
    "type" "DealType" NOT NULL,
    "plateKeys" TEXT[],
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "price" INTEGER,
    "fee" INTEGER,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "rolls" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "telegramChargeId" TEXT,
    "providerChargeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "QuestProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameConfigVersion" (
    "version" SERIAL NOT NULL,
    "data" JSONB NOT NULL,
    "createdBy" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameConfigVersion_pkey" PRIMARY KEY ("version")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "Plate_key_key" ON "Plate"("key");

-- CreateIndex
CREATE INDEX "Plate_ownerId_tier_idx" ON "Plate"("ownerId", "tier");

-- CreateIndex
CREATE INDEX "Plate_ownerId_acquiredAt_idx" ON "Plate"("ownerId", "acquiredAt");

-- CreateIndex
CREATE INDEX "Plate_body_idx" ON "Plate"("body");

-- CreateIndex
CREATE INDEX "Plate_region_idx" ON "Plate"("region");

-- CreateIndex
CREATE INDEX "PlateOwnership_plateId_acquiredAt_idx" ON "PlateOwnership"("plateId", "acquiredAt");

-- CreateIndex
CREATE INDEX "PlateOwnership_userId_idx" ON "PlateOwnership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_activePlateId_key" ON "Listing"("activePlateId");

-- CreateIndex
CREATE INDEX "Listing_status_price_idx" ON "Listing"("status", "price");

-- CreateIndex
CREATE INDEX "Listing_status_createdAt_idx" ON "Listing"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Listing_sellerId_status_idx" ON "Listing"("sellerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TradeOffer_code_key" ON "TradeOffer"("code");

-- CreateIndex
CREATE INDEX "TradeOffer_fromUserId_status_idx" ON "TradeOffer"("fromUserId", "status");

-- CreateIndex
CREATE INDEX "TradeOffer_toUserId_status_idx" ON "TradeOffer"("toUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TradeItem_offerId_plateId_key" ON "TradeItem"("offerId", "plateId");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_refId_idx" ON "LedgerEntry"("refId");

-- CreateIndex
CREATE INDEX "RollLog_userId_createdAt_idx" ON "RollLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RollLog_createdAt_idx" ON "RollLog"("createdAt");

-- CreateIndex
CREATE INDEX "DealLog_fromUserId_createdAt_idx" ON "DealLog"("fromUserId", "createdAt");

-- CreateIndex
CREATE INDEX "DealLog_toUserId_createdAt_idx" ON "DealLog"("toUserId", "createdAt");

-- CreateIndex
CREATE INDEX "DealLog_createdAt_idx" ON "DealLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_telegramChargeId_key" ON "Payment"("telegramChargeId");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuestProgress_userId_questId_day_key" ON "QuestProgress"("userId", "questId", "day");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plate" ADD CONSTRAINT "Plate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateOwnership" ADD CONSTRAINT "PlateOwnership_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlateOwnership" ADD CONSTRAINT "PlateOwnership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOffer" ADD CONSTRAINT "TradeOffer_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeOffer" ADD CONSTRAINT "TradeOffer_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeItem" ADD CONSTRAINT "TradeItem_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "TradeOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeItem" ADD CONSTRAINT "TradeItem_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RollLog" ADD CONSTRAINT "RollLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RollLog" ADD CONSTRAINT "RollLog_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestProgress" ADD CONSTRAINT "QuestProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Защита на уровне БД: балансы и цены не бывают отрицательными.
ALTER TABLE "User" ADD CONSTRAINT "User_chips_nonnegative" CHECK ("chips" >= 0);
ALTER TABLE "User" ADD CONSTRAINT "User_rolls_nonnegative" CHECK ("rolls" >= 0);
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_price_positive" CHECK ("price" > 0);
ALTER TABLE "Plate" ADD CONSTRAINT "Plate_number_range" CHECK ("number" BETWEEN 1 AND 999);