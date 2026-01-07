import { Router, Request, Response } from "express";
import prisma from "../database/prisma";
import { EPGService } from "../services/epg.service";
import { EpgRepository } from "../repositories/epg.repository";
import { EpgGroupRepository } from "../repositories/epg-group.repository";
import { EpgJobService } from "../services/epg-job.service";

const router = Router();

/**
 * GET /api/epg - Get all EPG files for user
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const epgFiles = await EpgRepository.findAll(userId);

    res.json(epgFiles);
  } catch (error: any) {
    console.error("Get EPG files error:", error);
    res.status(500).json({ error: "Failed to get EPG files" });
  }
});

/**
 * POST /api/epg - Start async EPG import (for large files on Hobby plan)
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const { name, url } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: "EPG name and URL are required" });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    // Check if user already has a pending job
    const existingJob = await EpgJobService.getPendingJob(userId);
    if (existingJob) {
      return res.status(409).json({
        error: "You already have an EPG import in progress",
        jobId: existingJob.id,
      });
    }

    console.log(`📡 Creating EPG import job for "${name}" from: ${url}`);

    // Create async job (don't process yet - let polling handle it)
    const job = await EpgJobService.createJob(userId, name, url);

    // Return immediately - client will poll for progress
    res.json({
      success: true,
      jobId: job.id,
      status: "pending",
      progress: 0,
      message: "EPG import started. Poll /api/epg/job/" + job.id + " for progress.",
    });
  } catch (error: any) {
    console.error("Create EPG import job error:", error);
    res.status(500).json({ error: "Failed to start EPG import: " + error.message });
  }
});

/**
 * GET /api/epg/job/:id - Get EPG import job status (polling endpoint)
 */
router.get("/job/:id", async (req: Request, res: Response) => {
  const requestStartTime = Date.now();
  const jobId = parseInt(req.params.id);
  
  console.log(`\n=== 🔍 EPG Job Poll Request ===`);
  console.log(`Job ID: ${jobId}`);
  console.log(`Time: ${new Date().toISOString()}`);
  
  try {
    const userId = (req as any).session.user.id;
    console.log(`User ID: ${userId}`);

    if (isNaN(jobId)) {
      console.log(`❌ Invalid job ID: ${req.params.id}`);
      return res.status(400).json({ error: "Invalid job ID" });
    }

    console.log(`📊 Fetching job ${jobId} from database...`);
    const job = await EpgJobService.getJob(jobId, userId);

    if (!job) {
      console.log(`❌ Job ${jobId} not found for user ${userId}`);
      return res.status(404).json({ error: "Job not found" });
    }

    console.log(`✅ Job found: status="${job.status}", progress=${job.progress}%`);
    console.log(`   Message: ${job.message}`);
    console.log(`   Total channels: ${job.totalChannels}`);
    console.log(`   Imported channels: ${job.importedChannels}`);

    // If job is still in progress, process next chunk
    if (["pending", "downloading", "parsing", "importing"].includes(job.status)) {
      console.log(`🔄 Job is in progress, processing next chunk...`);
      
      try {
        const chunkStartTime = Date.now();
        await EpgJobService.processImportChunk(jobId, 8000);
        const chunkDuration = Date.now() - chunkStartTime;
        console.log(`✅ Chunk processed in ${chunkDuration}ms`);
      } catch (chunkError: any) {
        console.error(`❌ Error processing chunk for job ${jobId}:`, chunkError);
        console.error(`   Error name: ${chunkError.name}`);
        console.error(`   Error message: ${chunkError.message}`);
        console.error(`   Error stack:`, chunkError.stack);
        // Don't fail the whole request - just return current status
        // The job status will be updated to "failed" by the service
      }
      
      // Get updated status
      console.log(`📊 Fetching updated job status...`);
      const updatedJob = await EpgJobService.getJob(jobId, userId);
      console.log(`✅ Updated status: "${updatedJob?.status}", progress=${updatedJob?.progress}%`);
      
      const totalDuration = Date.now() - requestStartTime;
      console.log(`⏱️ Total request time: ${totalDuration}ms`);
      console.log(`=== End Poll Request ===\n`);
      
      return res.json(updatedJob);
    }

    console.log(`✅ Job is complete/failed, returning status`);
    const totalDuration = Date.now() - requestStartTime;
    console.log(`⏱️ Total request time: ${totalDuration}ms`);
    console.log(`=== End Poll Request ===\n`);
    
    res.json(job);
  } catch (error: any) {
    console.error(`\n❌❌❌ CRITICAL ERROR in EPG job polling ❌❌❌`);
    console.error(`Job ID: ${jobId}`);
    console.error(`Error name: ${error.name}`);
    console.error(`Error message: ${error.message}`);
    console.error(`Error code: ${error.code}`);
    console.error(`Error stack:`, error.stack);
    
    const totalDuration = Date.now() - requestStartTime;
    console.error(`⏱️ Failed after: ${totalDuration}ms`);
    console.error(`=== End Poll Request (ERROR) ===\n`);
    
    res.status(500).json({ 
      error: "Failed to get job status",
      details: error.message,
      code: error.code 
    });
  }
});

/**
 * POST /api/epg/import-small - Direct import for small EPG files (<10MB)
 * This is the old synchronous method, kept for backward compatibility
 */
router.post("/import-small", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const { name, url } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: "EPG name and URL are required" });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    console.log(`📡 Importing small EPG "${name}" from: ${url}`);

    // Import and parse EPG (streaming) and dedupe by tvgId/name
    const rawChannels = await EPGService.importEPGStream(url);
    const unique = new Map<string, any>();
    rawChannels.forEach((ch) => {
      const key = ch.tvgId || ch.name;
      if (!unique.has(key)) unique.set(key, ch);
    });
    const channels = Array.from(unique.values());

    console.log(`📺 Found ${channels.length} channels in EPG`);

    // Create EPG file record
    const epgFile = await EpgRepository.create({
      userId,
      name,
      url,
      channelCount: channels.length,
      isDefault: false, // Will be set to true if first EPG by repository
    });

    // Get existing channel lineup for this EPG to check for duplicates
    const existingChannels = await prisma.channelLineup.findMany({
      where: { userId, epgFileId: epgFile.id },
      select: { tvgId: true, name: true },
    });

    const existingTvgIds = new Set(
      existingChannels.map((ch) => ch.tvgId).filter(Boolean)
    );
    const existingNames = new Set(
      existingChannels.map((ch) => ch.name.toLowerCase())
    );

    // Get max sortOrder for new channels
    const maxSortOrder = await prisma.channelLineup.findFirst({
      where: { userId, epgFileId: epgFile.id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    let sortOrder = (maxSortOrder?.sortOrder || 0) + 1;

    // Filter out duplicates and insert new channels
    const newChannels = channels.filter((ch) => {
      // Skip if tvg-id already exists
      if (ch.tvgId && existingTvgIds.has(ch.tvgId)) {
        return false;
      }
      // Skip if name already exists (case insensitive)
      if (existingNames.has(ch.name.toLowerCase())) {
        return false;
      }
      return true;
    });

    console.log(
      `➕ Importing ${newChannels.length} new channels (${
        channels.length - newChannels.length
      } duplicates skipped)`
    );

    // Insert new channels in batches with "Imported channels" category
    const BATCH_SIZE = 100;
    let imported = 0;

    for (let i = 0; i < newChannels.length; i += BATCH_SIZE) {
      const batch = newChannels.slice(i, i + BATCH_SIZE);

      await prisma.channelLineup.createMany({
        data: batch.map((ch) => ({
          userId,
          epgFileId: epgFile.id,
          name: ch.name,
          tvgId: ch.tvgId,
          tvgLogo: ch.tvgLogo || null,
          extGrp: "Imported channels", // Automatically assign category for imported channels
          sortOrder: sortOrder++,
        })),
      });

      imported += batch.length;
    }

    console.log(`✅ Successfully imported ${imported} channels from EPG`);

    res.json({
      success: true,
      epgFile,
      imported,
      duplicates: channels.length - newChannels.length,
      total: channels.length,
      message: `Imported ${imported} channels from EPG (${
        channels.length - newChannels.length
      } duplicates skipped)`,
    });
  } catch (error: any) {
    console.error("EPG import error:", error);
    res.status(500).json({
      error: error.message || "Failed to import EPG",
    });
  }
});

/**
 * PUT /api/epg/:id - Update EPG file
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const { name, url } = req.body;

    const updateData: any = {};
    if (name) updateData.name = name;
    if (url) {
      try {
        new URL(url);
        updateData.url = url;
      } catch (e) {
        return res.status(400).json({ error: "Invalid URL format" });
      }
    }

    const updated = await EpgRepository.update(id, userId, updateData);

    if (!updated) {
      return res.status(404).json({ error: "EPG file not found" });
    }

    res.json(updated);
  } catch (error: any) {
    console.error("Update EPG file error:", error);
    res.status(500).json({ error: "Failed to update EPG file" });
  }
});

/**
 * DELETE /api/epg/:id - Delete EPG file
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);

    const deleted = await EpgRepository.delete(id, userId);

    if (!deleted) {
      return res.status(404).json({ error: "EPG file not found" });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Delete EPG file error:", error);
    res.status(500).json({ error: "Failed to delete EPG file" });
  }
});

/**
 * POST /api/epg/:id/sync - Start async sync for an existing EPG file (uses same job pipeline as import)
 */
router.post("/:id/sync", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const epgFileId = parseInt(req.params.id);

    if (isNaN(epgFileId)) {
      return res.status(400).json({ error: "Invalid EPG file ID" });
    }

    const epgFile = await EpgRepository.findById(epgFileId, userId);

    if (!epgFile) {
      return res.status(404).json({ error: "EPG file not found" });
    }

    console.log(`🔄 Starting EPG sync job for "${epgFile.name}" (${epgFileId})`);

    const job = await EpgJobService.createJob(
      userId,
      epgFile.name,
      epgFile.url,
      epgFileId
    );

    return res.json({
      success: true,
      jobId: job.id,
      status: job.status,
      progress: job.progress > 0 ? job.progress : 5,
      message: "Sync started.",
    });
  } catch (error: any) {
    console.error("Sync EPG file error:", error);
    res.status(500).json({ error: "Failed to sync EPG file: " + error.message });
  }
});

/**
 * POST /api/epg/:id/import-json - bulk update channels from JSON by tvgId
 * Body shape: { [channelName]: { tvgId: string, tvgLogo?: string, extGrp?: string } }
 */
router.post("/:id/import-json", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const epgFileId = parseInt(req.params.id);
    if (isNaN(epgFileId)) return res.status(400).json({ error: "Invalid EPG file ID" });

    const epgFile = await EpgRepository.findById(epgFileId, userId);
    if (!epgFile) return res.status(404).json({ error: "EPG file not found" });

    const payload = req.body || {};
    // Preserve input order: first non-default categories, then default "Imported channels"
    const defaultCategoryName = "Imported channels";
    const orderedEntries: Array<[string, any]> = [];
    const defaultEntries: Array<[string, any]> = [];
    for (const entry of Object.entries<any>(payload)) {
      const data = entry[1];
      const extGrp = data?.extGrp ? String(data.extGrp) : undefined;
      const isDefault =
        !extGrp || extGrp.toLowerCase() === defaultCategoryName.toLowerCase();
      if (isDefault) {
        defaultEntries.push(entry);
      } else {
        orderedEntries.push(entry);
      }
    }
    const allEntries = [...orderedEntries, ...defaultEntries];

    let updated = 0;
    let sortOrderCounter = 0;
    for (const [name, data] of allEntries) {
      if (!data?.tvgId) continue; // tvgId required
      const tvgId = (data.tvgId as string).trim();
      if (!tvgId) continue;
      const tvgLogo = data.tvgLogo ? String(data.tvgLogo) : undefined;
      const extGrp = data.extGrp ? String(data.extGrp) : undefined;

      const result = await prisma.channelLineup.updateMany({
        where: { userId, epgFileId, tvgId },
        data: {
          name,
          tvgLogo: tvgLogo || null,
          extGrp: extGrp || undefined,
          sortOrder: sortOrderCounter++,
        },
      });
      updated += result.count;
    }

    return res.json({ success: true, updated });
  } catch (error: any) {
    console.error("Import EPG JSON error:", error);
    res.status(500).json({ error: "Failed to import EPG JSON: " + error.message });
  }
});

/**
 * GET /api/epg/:id/export-json?filtered=true|false
 */
router.get("/:id/export-json", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const epgFileId = parseInt(req.params.id);
    if (isNaN(epgFileId)) return res.status(400).json({ error: "Invalid EPG file ID" });

    const epgFile = await EpgRepository.findById(epgFileId, userId);
    if (!epgFile) return res.status(404).json({ error: "EPG file not found" });

    const filtered = String(req.query.filtered || "false") === "true";
    const channels = await prisma.channelLineup.findMany({
      where: {
        userId,
        epgFileId,
        ...(filtered
          ? {
              NOT: {
                extGrp: {
                  equals: "Imported channels",
                  mode: "insensitive",
                } as any,
              },
            }
          : {}),
      },
      orderBy: [
        { sortOrder: "asc" },
        { id: "asc" },
      ],
    });

    const payload: Record<string, any> = {};
    for (const ch of channels) {
      payload[ch.name] = {
        tvgId: ch.tvgId,
        tvgLogo: ch.tvgLogo,
        extGrp: ch.extGrp,
      };
    }

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${epgFile.name || "epg"}${filtered ? "-filtered" : ""}.json"`
    );
    res.json(payload);
  } catch (error: any) {
    console.error("Export EPG JSON error:", error);
    res.status(500).json({ error: "Failed to export EPG JSON: " + error.message });
  }
});

/**
 * GET /api/epg/:id/export-xmltv?filtered=true|false
 * Filters channels by extGrp != "Imported channels" when filtered=true.
 */
router.get("/:id/export-xmltv", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const epgFileId = parseInt(req.params.id);
    if (isNaN(epgFileId)) return res.status(400).json({ error: "Invalid EPG file ID" });

    const epgFile = await EpgRepository.findById(epgFileId, userId);
    if (!epgFile) return res.status(404).json({ error: "EPG file not found" });

    const filtered = String(req.query.filtered || "false") === "true";

    // Get current channel lineup (to know allowed tvgIds)
    const lineup = await prisma.channelLineup.findMany({
      where: {
        userId,
        epgFileId,
        ...(filtered
          ? {
              NOT: {
                extGrp: {
                  equals: "Imported channels",
                  mode: "insensitive",
                } as any,
              },
            }
          : {}),
      },
      select: { tvgId: true, sortOrder: true },
      orderBy: [
        { sortOrder: "asc" },
        { id: "asc" },
      ],
    });
    const allowedTvgIds = new Set(
      lineup.filter((c) => c.tvgId).map((c) => c.tvgId as string)
    );
    const sortOrderMap = new Map<string, number>();
    lineup.forEach((c) => {
      if (c.tvgId) sortOrderMap.set(c.tvgId, c.sortOrder ?? 0);
    });

    // Fetch original XML (string) and parse
    const xmlStr = await EPGService.fetchEPG(epgFile.url);
    const parser = EPGService.xmlParserForExport();
    const parsed = parser.parse(xmlStr);
    const tv = parsed?.tv || {};
    const channels = Array.isArray(tv.channel) ? tv.channel : tv.channel ? [tv.channel] : [];
    const programmes = Array.isArray(tv.programme)
      ? tv.programme
      : tv.programme
      ? [tv.programme]
      : [];

    const filteredChannels = channels
      .filter((c: any) => c?.["@_id"] && allowedTvgIds.has(c["@_id"]))
      .sort((a: any, b: any) => {
        const sa = sortOrderMap.get(a["@_id"]) ?? Number.MAX_SAFE_INTEGER;
        const sb = sortOrderMap.get(b["@_id"]) ?? Number.MAX_SAFE_INTEGER;
        return sa - sb;
      });
    const filteredProgrammes = programmes.filter(
      (p: any) => p?.["@_channel"] && allowedTvgIds.has(p["@_channel"])
    );

    const builder = EPGService.xmlBuilderForExport();
    const xmlOut = builder.build({
      tv: {
        channel: filteredChannels,
        programme: filteredProgrammes,
      },
    });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${epgFile.name || "epg"}${filtered ? "-filtered" : ""}.xml"`
    );
    res.type("application/xml").send(xmlOut);
  } catch (error: any) {
    console.error("Export EPG XMLTV error:", error);
    res.status(500).json({ error: "Failed to export EPG XMLTV: " + error.message });
  }
});

/**
 * PUT /api/epg/:id/set-default - Set an EPG file as the default
 */
router.put("/:id/set-default", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const epgFileId = parseInt(req.params.id);

    if (isNaN(epgFileId)) {
      return res.status(400).json({ error: "Invalid EPG file ID" });
    }

    const epgFile = await EpgRepository.setDefault(epgFileId, userId);

    if (!epgFile) {
      return res.status(404).json({ error: "EPG file not found" });
    }

    res.json(epgFile);
  } catch (error: any) {
    console.error("Set default EPG error:", error);
    res.status(500).json({ error: "Failed to set default EPG file" });
  }
});

/**
 * GET /api/epg/groups - Get all EPG groups for user
 */
router.get("/groups", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const epgGroups = await EpgGroupRepository.findAll(userId);

    res.json(epgGroups);
  } catch (error: any) {
    console.error("Get EPG groups error:", error);
    res.status(500).json({ error: "Failed to get EPG groups" });
  }
});

/**
 * POST /api/epg/groups - Create a new EPG group
 */
router.post("/groups", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const { name, url, epgFileIds } = req.body;

    if (!name || !url) {
      return res.status(400).json({ error: "Name and URL are required" });
    }

    if (!epgFileIds || epgFileIds.length === 0) {
      return res
        .status(400)
        .json({ error: "At least one EPG file must be selected" });
    }

    const epgGroup = await EpgGroupRepository.create(
      {
        userId,
        name,
        url,
        isDefault: false,
      },
      epgFileIds
    );

    res.status(201).json(epgGroup);
  } catch (error: any) {
    console.error("Create EPG group error:", error);
    res.status(500).json({ error: "Failed to create EPG group" });
  }
});

/**
 * PUT /api/epg/groups/:id - Update an EPG group
 */
router.put("/groups/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const epgGroupId = parseInt(req.params.id);
    const { name, url, epgFileIds } = req.body;

    if (isNaN(epgGroupId)) {
      return res.status(400).json({ error: "Invalid EPG group ID" });
    }

    if (epgFileIds && epgFileIds.length === 0) {
      return res
        .status(400)
        .json({ error: "At least one EPG file must be selected" });
    }

    const epgGroup = await EpgGroupRepository.update(
      epgGroupId,
      userId,
      { name, url },
      epgFileIds
    );

    if (!epgGroup) {
      return res.status(404).json({ error: "EPG group not found" });
    }

    res.json(epgGroup);
  } catch (error: any) {
    console.error("Update EPG group error:", error);
    res.status(500).json({ error: "Failed to update EPG group" });
  }
});

/**
 * DELETE /api/epg/groups/:id - Delete an EPG group
 */
router.delete("/groups/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const epgGroupId = parseInt(req.params.id);

    if (isNaN(epgGroupId)) {
      return res.status(400).json({ error: "Invalid EPG group ID" });
    }

    const deleted = await EpgGroupRepository.delete(epgGroupId, userId);

    if (!deleted) {
      return res.status(404).json({ error: "EPG group not found" });
    }

    res.status(204).send();
  } catch (error: any) {
    console.error("Delete EPG group error:", error);
    res.status(500).json({ error: "Failed to delete EPG group" });
  }
});

/**
 * PUT /api/epg/groups/:id/set-default - Set an EPG group as the default
 */
router.put("/groups/:id/set-default", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const epgGroupId = parseInt(req.params.id);

    if (isNaN(epgGroupId)) {
      return res.status(400).json({ error: "Invalid EPG group ID" });
    }

    const epgGroup = await EpgGroupRepository.setDefault(epgGroupId, userId);

    if (!epgGroup) {
      return res.status(404).json({ error: "EPG group not found" });
    }

    res.json(epgGroup);
  } catch (error: any) {
    console.error("Set default EPG group error:", error);
    res.status(500).json({ error: "Failed to set default EPG group" });
  }
});

export default router;
