-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('rolls', 'car', 'paint', 'garage_slot');

-- CreateEnum
CREATE TYPE "CarClass" AS ENUM ('economy', 'comfort', 'business', 'premium', 'luxury', 'collectible');

-- CreateEnum
CREATE TYPE "CarAcquireVia" AS ENUM ('showroom', 'market');

-- CreateEnum
CREATE TYPE "CarReleaseVia" AS ENUM ('system_sell', 'market');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('active', 'collected');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('active', 'settled', 'unsold');

-- CreateEnum
CREATE TYPE "ExhibitionStatus" AS ENUM ('open', 'settled');

-- CreateEnum
CREATE TYPE "ClubRole" AS ENUM ('owner', 'member');

-- AlterEnum
ALTER TYPE "AcquireVia" ADD VALUE 'auction';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DealType" ADD VALUE 'auction';
ALTER TYPE "DealType" ADD VALUE 'car_system_sell';
ALTER TYPE "DealType" ADD VALUE 'car_market_sale';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerReason" ADD VALUE 'car_purchase';
ALTER TYPE "LedgerReason" ADD VALUE 'car_system_sell';
ALTER TYPE "LedgerReason" ADD VALUE 'car_market_buy';
ALTER TYPE "LedgerReason" ADD VALUE 'car_market_sale';
ALTER TYPE "LedgerReason" ADD VALUE 'garage_slot';
ALTER TYPE "LedgerReason" ADD VALUE 'plate_fee';
ALTER TYPE "LedgerReason" ADD VALUE 'tuning';
ALTER TYPE "LedgerReason" ADD VALUE 'trip_income';
ALTER TYPE "LedgerReason" ADD VALUE 'race_bet';
ALTER TYPE "LedgerReason" ADD VALUE 'race_refund';
ALTER TYPE "LedgerReason" ADD VALUE 'race_win';
ALTER TYPE "LedgerReason" ADD VALUE 'auction_bid';
ALTER TYPE "LedgerReason" ADD VALUE 'auction_refund';
ALTER TYPE "LedgerReason" ADD VALUE 'exhibition_vote';
ALTER TYPE "LedgerReason" ADD VALUE 'prize';
ALTER TYPE "LedgerReason" ADD VALUE 'club_create';

-- AlterTable
ALTER TABLE "DealLog" ADD COLUMN     "carIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'rolls',
ADD COLUMN     "meta" JSONB,
ALTER COLUMN "rolls" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Plate" ADD COLUMN     "reserved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "extraGarageSlots" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "unlockedPaints" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CarModel" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "class" "CarClass" NOT NULL,
    "archetype" TEXT NOT NULL,
    "speed" INTEGER NOT NULL,
    "acceleration" INTEGER NOT NULL,
    "handling" INTEGER NOT NULL,
    "prestige" INTEGER NOT NULL,
    "priceChips" INTEGER NOT NULL,
    "priceStars" INTEGER,
    "showroom" TEXT NOT NULL,
    "editionSize" INTEGER,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "styleNumbers" INTEGER[],
    "season" TEXT,
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCar" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "modelId" TEXT NOT NULL,
    "serial" INTEGER,
    "tuning" JSONB NOT NULL,
    "plateId" TEXT,
    "plateChangedAt" TIMESTAMP(3),
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarOwnership" (
    "id" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acquiredVia" "CarAcquireVia" NOT NULL,
    "acquiredPrice" INTEGER,
    "releasedAt" TIMESTAMP(3),
    "releasedVia" "CarReleaseVia",
    "releasedPrice" INTEGER,

    CONSTRAINT "CarOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarListing" (
    "id" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "withPlate" BOOLEAN NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'active',
    "activeCarId" TEXT,
    "buyerId" TEXT,
    "fee" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CarListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarTrip" (
    "id" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "baseIncome" INTEGER NOT NULL,
    "eventId" TEXT,
    "income" INTEGER NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'active',
    "activeCarId" TEXT,
    "collectedAt" TIMESTAMP(3),

    CONSTRAINT "CarTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaceQueueEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "bet" INTEGER NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaceQueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Race" (
    "id" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "carAId" TEXT NOT NULL,
    "userBId" TEXT,
    "carBId" TEXT,
    "racerA" JSONB NOT NULL,
    "racerB" JSONB NOT NULL,
    "winnerSide" TEXT NOT NULL,
    "winnerUserId" TEXT,
    "bet" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Race_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auction" (
    "id" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "plateId" TEXT NOT NULL,
    "startPrice" INTEGER NOT NULL,
    "currentBid" INTEGER,
    "leaderId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "originalEndsAt" TIMESTAMP(3) NOT NULL,
    "status" "AuctionStatus" NOT NULL DEFAULT 'active',
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionBid" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exhibition" (
    "id" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "status" "ExhibitionStatus" NOT NULL DEFAULT 'open',
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Exhibition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExhibitionEntry" (
    "id" TEXT NOT NULL,
    "exhibitionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "carId" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "shows" INTEGER NOT NULL DEFAULT 0,
    "place" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExhibitionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExhibitionVote" (
    "id" TEXT NOT NULL,
    "exhibitionId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "winnerEntryId" TEXT NOT NULL,
    "rewarded" BOOLEAN NOT NULL,
    "dayKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExhibitionVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "chatLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubMember" (
    "userId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "role" "ClubRole" NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubMember_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "DreamMask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mask" TEXT NOT NULL,
    "bodyLike" TEXT NOT NULL,
    "regionLike" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DreamMask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("userId","achievementId")
);

-- CreateTable
CREATE TABLE "SchedulerRun" (
    "key" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchedulerRun_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserCar_plateId_key" ON "UserCar"("plateId");

-- CreateIndex
CREATE INDEX "UserCar_ownerId_idx" ON "UserCar"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCar_modelId_serial_key" ON "UserCar"("modelId", "serial");

-- CreateIndex
CREATE INDEX "CarOwnership_carId_acquiredAt_idx" ON "CarOwnership"("carId", "acquiredAt");

-- CreateIndex
CREATE INDEX "CarOwnership_userId_idx" ON "CarOwnership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CarListing_activeCarId_key" ON "CarListing"("activeCarId");

-- CreateIndex
CREATE INDEX "CarListing_status_createdAt_idx" ON "CarListing"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CarListing_sellerId_status_idx" ON "CarListing"("sellerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CarTrip_activeCarId_key" ON "CarTrip"("activeCarId");

-- CreateIndex
CREATE INDEX "CarTrip_userId_status_idx" ON "CarTrip"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RaceQueueEntry_userId_key" ON "RaceQueueEntry"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RaceQueueEntry_carId_key" ON "RaceQueueEntry"("carId");

-- CreateIndex
CREATE INDEX "RaceQueueEntry_bet_createdAt_idx" ON "RaceQueueEntry"("bet", "createdAt");

-- CreateIndex
CREATE INDEX "Race_userAId_createdAt_idx" ON "Race"("userAId", "createdAt");

-- CreateIndex
CREATE INDEX "Race_userBId_createdAt_idx" ON "Race"("userBId", "createdAt");

-- CreateIndex
CREATE INDEX "Race_weekKey_winnerUserId_idx" ON "Race"("weekKey", "winnerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Auction_dayKey_key" ON "Auction"("dayKey");

-- CreateIndex
CREATE INDEX "Auction_status_endsAt_idx" ON "Auction"("status", "endsAt");

-- CreateIndex
CREATE INDEX "AuctionBid_auctionId_createdAt_idx" ON "AuctionBid"("auctionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Exhibition_weekKey_key" ON "Exhibition"("weekKey");

-- CreateIndex
CREATE INDEX "ExhibitionEntry_carId_idx" ON "ExhibitionEntry"("carId");

-- CreateIndex
CREATE UNIQUE INDEX "ExhibitionEntry_exhibitionId_userId_key" ON "ExhibitionEntry"("exhibitionId", "userId");

-- CreateIndex
CREATE INDEX "ExhibitionVote_voterId_dayKey_idx" ON "ExhibitionVote"("voterId", "dayKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExhibitionVote_exhibitionId_voterId_pairKey_key" ON "ExhibitionVote"("exhibitionId", "voterId", "pairKey");

-- CreateIndex
CREATE UNIQUE INDEX "Club_nameKey_key" ON "Club"("nameKey");

-- CreateIndex
CREATE INDEX "ClubMember_clubId_idx" ON "ClubMember"("clubId");

-- CreateIndex
CREATE UNIQUE INDEX "DreamMask_userId_mask_key" ON "DreamMask"("userId", "mask");

-- AddForeignKey
ALTER TABLE "UserCar" ADD CONSTRAINT "UserCar_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCar" ADD CONSTRAINT "UserCar_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "CarModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCar" ADD CONSTRAINT "UserCar_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarOwnership" ADD CONSTRAINT "CarOwnership_carId_fkey" FOREIGN KEY ("carId") REFERENCES "UserCar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarOwnership" ADD CONSTRAINT "CarOwnership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarListing" ADD CONSTRAINT "CarListing_carId_fkey" FOREIGN KEY ("carId") REFERENCES "UserCar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarListing" ADD CONSTRAINT "CarListing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarListing" ADD CONSTRAINT "CarListing_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarTrip" ADD CONSTRAINT "CarTrip_carId_fkey" FOREIGN KEY ("carId") REFERENCES "UserCar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarTrip" ADD CONSTRAINT "CarTrip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceQueueEntry" ADD CONSTRAINT "RaceQueueEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceQueueEntry" ADD CONSTRAINT "RaceQueueEntry_carId_fkey" FOREIGN KEY ("carId") REFERENCES "UserCar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_plateId_fkey" FOREIGN KEY ("plateId") REFERENCES "Plate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionBid" ADD CONSTRAINT "AuctionBid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionBid" ADD CONSTRAINT "AuctionBid_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExhibitionEntry" ADD CONSTRAINT "ExhibitionEntry_exhibitionId_fkey" FOREIGN KEY ("exhibitionId") REFERENCES "Exhibition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExhibitionEntry" ADD CONSTRAINT "ExhibitionEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExhibitionEntry" ADD CONSTRAINT "ExhibitionEntry_carId_fkey" FOREIGN KEY ("carId") REFERENCES "UserCar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExhibitionVote" ADD CONSTRAINT "ExhibitionVote_exhibitionId_fkey" FOREIGN KEY ("exhibitionId") REFERENCES "Exhibition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubMember" ADD CONSTRAINT "ClubMember_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DreamMask" ADD CONSTRAINT "DreamMask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
