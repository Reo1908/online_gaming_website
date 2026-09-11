-- CreateEnum
CREATE TYPE "MatchVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "visibility" "MatchVisibility" NOT NULL DEFAULT 'PRIVATE';

-- AlterTable
ALTER TABLE "MatchPlayer" ADD COLUMN     "isPlaying" BOOLEAN NOT NULL DEFAULT true;

-- Bestehende Partien: die Spielleitung des Buzzer-Spiels hat nie mitgespielt.
-- Ohne diese Zeile wuerde sie rueckwirkend in jeder Wertung auftauchen.
UPDATE "MatchPlayer" SET "isPlaying" = false WHERE "isGamemaster" = true;

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagWord" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "TagWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchTag" (
    "matchId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "MatchTag_pkey" PRIMARY KEY ("matchId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "Tag_isActive_idx" ON "Tag"("isActive");

-- CreateIndex
CREATE INDEX "TagWord_tagId_idx" ON "TagWord"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "TagWord_tagId_text_key" ON "TagWord"("tagId", "text");

-- CreateIndex
CREATE INDEX "MatchTag_tagId_idx" ON "MatchTag"("tagId");

-- CreateIndex
CREATE INDEX "Match_status_visibility_idx" ON "Match"("status", "visibility");

-- AddForeignKey
ALTER TABLE "TagWord" ADD CONSTRAINT "TagWord_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchTag" ADD CONSTRAINT "MatchTag_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchTag" ADD CONSTRAINT "MatchTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
