import prisma from "../database/prisma";

export interface EpgGroup {
  id?: number;
  userId: number;
  name: string;
  url: string;
  isDefault: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export class EpgGroupRepository {
  /**
   * Find all EPG groups for a user (default first, then by ID)
   */
  static async findAll(userId: number): Promise<any[]> {
    const epgGroups = await prisma.epgGroup.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { id: "asc" }],
      include: {
        epgFiles: {
          select: {
            id: true,
            name: true,
            channelCount: true,
          },
        },
      },
    });

    // Calculate total channel count for each group
    return epgGroups.map((group) => ({
      ...group,
      epgFileIds: group.epgFiles.map((f) => f.id),
      totalChannelCount: group.epgFiles.reduce(
        (sum, f) => sum + f.channelCount,
        0
      ),
    }));
  }

  /**
   * Find EPG group by ID
   */
  static async findById(id: number, userId: number): Promise<any | null> {
    const epgGroup = await prisma.epgGroup.findFirst({
      where: { id, userId },
      include: {
        epgFiles: {
          select: {
            id: true,
            name: true,
            channelCount: true,
          },
        },
      },
    });

    if (!epgGroup) return null;

    return {
      ...epgGroup,
      epgFileIds: epgGroup.epgFiles.map((f) => f.id),
      totalChannelCount: epgGroup.epgFiles.reduce(
        (sum, f) => sum + f.channelCount,
        0
      ),
    };
  }

  /**
   * Get the default EPG group for a user
   */
  static async getDefault(userId: number): Promise<any | null> {
    const epgGroup = await prisma.epgGroup.findFirst({
      where: { userId, isDefault: true },
      include: {
        epgFiles: {
          select: {
            id: true,
            name: true,
            channelCount: true,
          },
        },
      },
    });

    if (!epgGroup) return null;

    return {
      ...epgGroup,
      epgFileIds: epgGroup.epgFiles.map((f) => f.id),
      totalChannelCount: epgGroup.epgFiles.reduce(
        (sum, f) => sum + f.channelCount,
        0
      ),
    };
  }

  /**
   * Create a new EPG group
   */
  static async create(
    data: Omit<EpgGroup, "id">,
    epgFileIds: number[]
  ): Promise<any> {
    // If this is the first EPG file/group for the user, make it default
    const existingEpgFilesCount = await prisma.epgFile.count({
      where: { userId: data.userId },
    });
    const existingEpgGroupsCount = await prisma.epgGroup.count({
      where: { userId: data.userId },
    });

    const isDefault =
      existingEpgFilesCount === 0 && existingEpgGroupsCount === 0
        ? true
        : data.isDefault || false;

    // Create the group
    const created = await prisma.epgGroup.create({
      data: {
        ...data,
        isDefault,
      },
      include: {
        epgFiles: {
          select: {
            id: true,
            name: true,
            channelCount: true,
          },
        },
      },
    });

    // Associate EPG files with this group
    if (epgFileIds.length > 0) {
      await prisma.epgFile.updateMany({
        where: {
          id: { in: epgFileIds },
          userId: data.userId,
        },
        data: {
          epgGroupId: created.id,
        },
      });
    }

    // Fetch again to get updated epgFiles
    const updated = await this.findById(created.id, data.userId);
    return updated;
  }

  /**
   * Update EPG group
   */
  static async update(
    id: number,
    userId: number,
    data: Partial<Omit<EpgGroup, "id" | "userId">>,
    epgFileIds?: number[]
  ): Promise<any | null> {
    const epgGroup = await prisma.epgGroup.findFirst({
      where: { id, userId },
    });

    if (!epgGroup) {
      return null;
    }

    // Update the group
    await prisma.epgGroup.update({
      where: { id },
      data,
    });

    // Update EPG file associations if provided
    if (epgFileIds !== undefined) {
      // Remove all current associations
      await prisma.epgFile.updateMany({
        where: { epgGroupId: id },
        data: { epgGroupId: null },
      });

      // Add new associations
      if (epgFileIds.length > 0) {
        await prisma.epgFile.updateMany({
          where: {
            id: { in: epgFileIds },
            userId,
          },
          data: {
            epgGroupId: id,
          },
        });
      }
    }

    return await this.findById(id, userId);
  }

  /**
   * Delete EPG group (EPG files are kept, just unlinked)
   */
  static async delete(id: number, userId: number): Promise<boolean> {
    const epgGroup = await prisma.epgGroup.findFirst({
      where: { id, userId },
    });

    if (!epgGroup) {
      return false;
    }

    // Unlink all EPG files from this group
    await prisma.epgFile.updateMany({
      where: { epgGroupId: id },
      data: { epgGroupId: null },
    });

    // Delete the group
    await prisma.epgGroup.delete({
      where: { id },
    });

    return true;
  }

  /**
   * Set an EPG group as the default (and unset all others for this user)
   */
  static async setDefault(
    id: number,
    userId: number
  ): Promise<any | null> {
    // Verify the EPG group exists and belongs to the user
    const epgGroup = await prisma.epgGroup.findFirst({
      where: { id, userId },
    });

    if (!epgGroup) {
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
      // Then set the selected group as default
      prisma.epgGroup.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);

    return await this.findById(id, userId);
  }
}

