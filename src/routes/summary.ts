// src/routes/summary.ts
import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import prisma from "../config/prismaClient";
import { generateSummary } from "../services/generateSummary";

const router = Router();

// Generate or retrieve summary
router.post(
  "/generate",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res
          .status(401)
          .json({ success: false, error: "User not authenticated" });
      }

      const { content, metadata } = req.body;

      if (!content) {
        return res
          .status(400)
          .json({ success: false, error: "Content (transcript) is required" });
      }

      if (!metadata || !metadata.videoId) {
        return res.status(400).json({
          success: false,
          error: "Video metadata with videoId is required",
        });
      }

      const videoUrl =
        metadata.url || `https://www.youtube.com/watch?v=${metadata.videoId}`;

      // Check for existing summary
      let existingSummary;
      try {
        existingSummary = await prisma.summary.findFirst({
          where: {
            videoUrl,
          },
        });

        if (existingSummary) {
          // Parse the stored summary into the expected format
          let keyPoints: string[] = [];
          let fullSummary = existingSummary.summary;
          let title = metadata.title || "Video Summary";

          // Try to extract key points and full summary from stored format
          const storedSummary = existingSummary.summary;
          const keyPointsMatch = storedSummary.match(
            /Key Points:([\s\S]*?)(?=\n\n|$)/i
          );

          if (keyPointsMatch) {
            keyPoints = keyPointsMatch[1]
              .split("-")
              .map((point: string) => point.trim())
              .filter((point: string) => point.length > 0);

            // Get the full summary part
            const fullSummaryMatch = storedSummary.match(
              /(?:Key Points:[\s\S]*?\n\n)([\s\S]*?)$/
            );
            if (fullSummaryMatch) {
              fullSummary = fullSummaryMatch[1].trim();
            }

            // Extract title if available from beginning of the summary
            const titleMatch = storedSummary.match(/^(.*?)\n/);
            if (titleMatch) {
              title = titleMatch[1].trim();
            }
          }

          return res.json({
            success: true,
            data: {
              title,
              keyPoints,
              fullSummary,
              sourceUrl: existingSummary.videoUrl,
              id: existingSummary.id,
              createdAt: existingSummary.createdAt,
            },
          });
        }
      } catch (dbError) {
        console.error("Database error checking for existing summary:", dbError);
        // Continue with summary generation even if DB lookup fails
      }

      // This credit check is now handled by the requireCredits middleware,
      // but we still need to get the current credit count to return it
      let userCredits;
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { credits: true },
        });

        if (!user) {
          return res.status(404).json({
            success: false,
            error: "User not found",
          });
        }

        userCredits = user.credits;
      } catch (dbError) {
        console.error("Database error getting user credits:", dbError);
        userCredits = 0; // Fallback value if we can't get the real count
      }

      // Generate summary
      const summary = await generateSummary(content, metadata);

      if (!summary.fullSummary) {
        return res.status(500).json({
          success: false,
          error: "Failed to generate summary",
        });
      }

      // Format summary for storage
      const summaryText = `${summary.title}\n\nKey Points:\n${summary.keyPoints
        .map((point) => `- ${point}`)
        .join("\n")}\n\n${summary.fullSummary}`;

      // Save summary to database and update user credits
      let newSummary;
      try {
        // Use a transaction for atomicity
        const result = await prisma.$transaction(async (tx) => {
          // Create the summary
          const createdSummary = await tx.summary.create({
            data: {
              userId,
              videoUrl,
              summary: summaryText,
              transcript: content,
            },
          });

          // Decrement user credits
          await tx.user.update({
            where: { id: userId },
            data: {
              credits: { decrement: 1 },
            },
          });

          return createdSummary;
        });

        newSummary = result;
      } catch (dbError) {
        console.error("Database error saving summary:", dbError);
        // Continue and return the summary even if saving fails
      }

      return res.json({
        success: true,
        data: {
          ...summary,
          id: newSummary?.id,
          sourceUrl: videoUrl,
          createdAt: newSummary?.createdAt,
        },
        creditsRemaining: Math.max(0, userCredits - 1),
      });
    } catch (error) {
      console.error("Error generating summary:", error);
      res.status(500).json({
        success: false,
        error: "Failed to generate summary",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// Rest of the methods remain the same but with improved error responses
// Get all summaries for a user
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const [summaries, total] = await Promise.all([
      prisma.summary.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.summary.count({
        where: { userId },
      }),
    ]);

    // Format summaries for the frontend
    const formattedSummaries = summaries.map((summary: any) => {
      // Try to extract title, key points, and full summary from the stored format
      let title = "";
      let keyPoints: string[] = [];
      let fullSummary = summary.summary;

      const titleMatch = summary.summary.match(/^(.*?)\n/);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }

      const keyPointsMatch = summary.summary.match(
        /Key Points:([\s\S]*?)(?=\n\n|$)/i
      );
      if (keyPointsMatch) {
        keyPoints = keyPointsMatch[1]
          .split("-")
          .map((point: string) => point.trim())
          .filter((point: string) => point.length > 0);

        const fullSummaryMatch = summary.summary.match(
          /(?:Key Points:[\s\S]*?\n\n)([\s\S]*?)$/
        );
        if (fullSummaryMatch) {
          fullSummary = fullSummaryMatch[1].trim();
        }
      }

      return {
        id: summary.id,
        title,
        keyPoints,
        fullSummary,
        sourceUrl: summary.videoUrl,
        createdAt: summary.createdAt,
      };
    });

    res.json({
      success: true,
      data: {
        summaries: formattedSummaries,
        total,
        page,
        limit,
      },
    });
  } catch (error) {
    console.error("Error fetching summaries:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch summaries",
      message: error instanceof Error ? error.message : "Unknown error",
      data: {
        summaries: [],
        total: 0,
        page: 1,
        limit: 10,
      },
    });
  }
});

// Save summary route - protected by auth
router.post(
  "/save",
  authMiddleware,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { videoId, title, keyPoints, fullSummary, sourceUrl } = req.body;

    if (!videoId || !title || !fullSummary) {
      res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
      return;
    }

    try {
      const videoUrl =
        sourceUrl || `https://www.youtube.com/watch?v=${videoId}`;

      // Format the summary for storage
      const summaryText = `${title}\n\nKey Points:\n${keyPoints
        .map((point: string) => `- ${point}`)
        .join("\n")}\n\n${fullSummary}`;

      const newSummary = await prisma.summary.create({
        data: {
          userId: req.user!.id,
          videoUrl,
          summary: summaryText,
          transcript: "", // Empty or placeholder
        },
      });

      res.json({
        success: true,
        data: {
          id: newSummary.id,
          createdAt: newSummary.createdAt,
        },
      });
    } catch (error) {
      console.error("Error saving summary:", error);
      res.status(500).json({
        success: false,
        error: "Failed to create summary",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// Get single summary route - protected by auth
router.get(
  "/:id",
  authMiddleware,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
      const summary = await prisma.summary.findFirst({
        where: {
          id,
          userId: req.user!.id,
        },
      });

      if (!summary) {
        res.status(404).json({
          success: false,
          error: "Summary not found",
        });
        return;
      }

      // Format the summary for the frontend
      let title = "";
      let keyPoints: string[] = [];
      let fullSummary = summary.summary;

      const titleMatch = summary.summary.match(/^(.*?)\n/);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }

      const keyPointsMatch = summary.summary.match(
        /Key Points:([\s\S]*?)(?=\n\n|$)/i
      );
      if (keyPointsMatch) {
        keyPoints = keyPointsMatch[1]
          .split("-")
          .map((point: string) => point.trim())
          .filter((point: string) => point.length > 0);

        const fullSummaryMatch = summary.summary.match(
          /(?:Key Points:[\s\S]*?\n\n)([\s\S]*?)$/
        );
        if (fullSummaryMatch) {
          fullSummary = fullSummaryMatch[1].trim();
        }
      }

      res.json({
        success: true,
        data: {
          id: summary.id,
          title,
          keyPoints,
          fullSummary,
          sourceUrl: summary.videoUrl,
          createdAt: summary.createdAt,
        },
      });
    } catch (error) {
      console.error("Error fetching summary:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch summary",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// Delete summary route - protected by auth
router.delete(
  "/:id",
  authMiddleware,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    try {
      // Verify owner
      const summary = await prisma.summary.findFirst({
        where: {
          id,
          userId: req.user!.id,
        },
      });

      if (!summary) {
        res.status(404).json({
          success: false,
          error: "Summary not found",
        });
        return;
      }

      // Delete summary
      await prisma.summary.delete({
        where: { id },
      });

      res.json({
        success: true,
        data: { id },
      });
    } catch (error) {
      console.error("Error deleting summary:", error);
      res.status(500).json({
        success: false,
        error: "Failed to delete summary",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

export default router;
