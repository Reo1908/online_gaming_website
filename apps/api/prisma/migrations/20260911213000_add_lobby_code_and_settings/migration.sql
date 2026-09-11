-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "code" TEXT NOT NULL,
ADD COLUMN     "name" TEXT NOT NULL,
ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "MatchPlayer" ADD COLUMN     "isGamemaster" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Match_code_key" ON "Match"("code");
