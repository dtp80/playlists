import { Router, Request, Response } from "express";
import prisma from "../database/prisma";

const router = Router();

const SCHEDULE_KEY = "syncSchedule";

router.get("/", async (_req: Request, res: Response) => {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: SCHEDULE_KEY },
    });
    if (!setting?.value) {
      return res.json({ schedule: [] });
    }
    try {
      const schedule = JSON.parse(setting.value);
      return res.json({ schedule: Array.isArray(schedule) ? schedule : [] });
    } catch {
      return res.json({ schedule: [] });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const { schedule } = req.body;
    if (!Array.isArray(schedule)) {
      return res.status(400).json({ error: "schedule must be an array" });
    }

    // Basic validation
    const sanitized = schedule
      .map((item: any) => ({
        playlistId: Number(item?.playlistId) || null,
        enabled: !!item?.enabled,
        time: typeof item?.time === "string" ? item.time : null,
      }))
      .filter((s: any) => s.playlistId && s.time);

    await prisma.setting.upsert({
      where: { key: SCHEDULE_KEY },
      update: { value: JSON.stringify(sanitized) },
      create: { key: SCHEDULE_KEY, value: JSON.stringify(sanitized) },
    });

    res.json({ success: true, schedule: sanitized });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
