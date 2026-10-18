-- People who already show golf practice get the new Simulator type switched on too.
UPDATE "User"
SET "visibleSessionTypes" = array_append("visibleSessionTypes", 'GOLF_SIMULATOR'::"SessionType")
WHERE 'GOLF_RANGE'::"SessionType" = ANY("visibleSessionTypes")
  AND NOT ('GOLF_SIMULATOR'::"SessionType" = ANY("visibleSessionTypes"));
