import prisma from "../database/prisma";

export interface EpgFile {
  id?: number;
  userId: number;
  name: string;
  url: string;
  channelCount: number;
  isDefault: boolean;
  lastSyncedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export class EpgRepository {
  /**
   * Find all EPG files for a user (default first, then by ID)
   */
  static async findAll(userId: number): Promise<EpgFile[]> {
    const epgFiles = await prisma.epgFile.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    });

    return epgFiles as EpgFile[];
  }

  /**
   * Find EPG file by ID
   */
  static async findById(id: number, userId: number): Promise<EpgFile | null> {
    const epgFile = await prisma.epgFile.findFirst({
      where: { id, userId },
    });

    return epgFile as EpgFile | null;
  }

  /**
   * Get the default EPG file for a user
   */
  static async getDefault(userId: number): Promise<EpgFile | null> {
    const epgFile = await prisma.epgFile.findFirst({
      where: { userId, isDefault: true },
    });

    return epgFile as EpgFile | null;
  }

  /**
   * Create a new EPG file
   */
  static async create(epgFile: Omit<EpgFile, "id">): Promise<EpgFile> {
    // If this is the first EPG file/group for the user, make it default
    const existingEpgFilesCount = await prisma.epgFile.count({
      where: { userId: epgFile.userId },
    });
    const existingEpgGroupsCount = await prisma.epgGroup.count({
      where: { userId: epgFile.userId },
    });

    const isDefault =
      existingEpgFilesCount === 0 && existingEpgGroupsCount === 0
        ? true
        : epgFile.isDefault || false;

    const created = await prisma.epgFile.create({
      data: {
        ...epgFile,
        isDefault,
      },
    });

    return created as EpgFile;
  }

  /**
   * Update EPG file
   */
  static async update(
    id: number,
    userId: number,
    data: Partial<Omit<EpgFile, "id" | "userId">>
  ): Promise<EpgFile | null> {
    const epgFile = await prisma.epgFile.findFirst({
      where: { id, userId },
    });

    if (!epgFile) {
      return null;
    }

    const updated = await prisma.epgFile.update({
      where: { id },
      data,
    });

    return updated as EpgFile;
  }

  /**
   * Delete EPG file and all associated channels
   */
  static async delete(id: number, userId: number): Promise<boolean> {
    const epgFile = await prisma.epgFile.findFirst({
      where: { id, userId },
    });

    if (!epgFile) {
      return false;
    }

    // Delete in a transaction to ensure consistency
    await prisma.$transaction([
      // First, delete all channels associated with this EPG file
      prisma.channelLineup.deleteMany({
        where: { epgFileId: id, userId },
      }),
      // Then delete the EPG file itself
      prisma.epgFile.delete({
        where: { id },
      }),
    ]);

    return true;
  }

  /**
   * Set an EPG file as the default (and unset all others for this user)
   */
  static async setDefault(id: number, userId: number): Promise<EpgFile | null> {
    // Verify the EPG file exists and belongs to the user
    const epgFile = await prisma.epgFile.findFirst({
      where: { id, userId },
    });

    if (!epgFile) {
      return null;
    }

    // Use a transaction to ensure atomicity
    await prisma.$transaction([
      // First, unset all default flags for this user (both files and groups)
      prisma.epgFile.updateMany({
        where: { userId },
        data: { isDefault: false },
      }),
      prisma.epgGroup.updateMany({
        where: { userId },
        data: { isDefault: false },
      }),
      // Then set the selected one as default
      prisma.epgFile.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);

    // Return the updated EPG file
    const updated = await prisma.epgFile.findUnique({
      where: { id },
    });

    return updated as EpgFile | null;
  }

  /**
   * Update sync timestamp and channel count for EPG file
   */
  static async updateSyncInfo(
    id: number,
    userId: number,
    channelCount: number
  ): Promise<EpgFile | null> {
    const epgFile = await prisma.epgFile.findFirst({
      where: { id, userId },
    });

    if (!epgFile) {
      return null;
    }

    const updated = await prisma.epgFile.update({
      where: { id },
      data: {
        channelCount,
        lastSyncedAt: new Date(),
      },
    });

    return updated as EpgFile;
  }
}
