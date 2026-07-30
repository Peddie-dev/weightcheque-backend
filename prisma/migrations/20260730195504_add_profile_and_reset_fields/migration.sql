-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "focusTime" TEXT,
ADD COLUMN     "foodTriggers" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "medicalConditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "medications" TEXT,
ADD COLUMN     "sleepHours" TEXT,
ADD COLUMN     "waistCircumference" DOUBLE PRECISION;
