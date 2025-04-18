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
      console.log(`Generating summary for video: ${videoUrl}`);

      // Check for existing summary (but don't save a new one yet)
      let existingSummary;
      try {
        existingSummary = await prisma.summary.findFirst({
          where: {
            videoUrl: videoUrl,
            userId: userId,
          },
        });

        console.log(`Existing summary found: ${!!existingSummary}`);

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
              alreadySaved: true, // Indicate this summary is already saved
            },
          });
        }
      } catch (dbError) {
        console.error("Database error checking for existing summary:", dbError);
      }

      // Get user credits
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

        // Check if user has enough credits
        if (userCredits <= 0) {
          return res.status(403).json({
            success: false,
            error: "Not enough credits to generate summary",
          });
        }
      } catch (dbError) {
        console.error("Database error getting user credits:", dbError);
        return res.status(500).json({
          success: false,
          error: "Failed to check user credits",
        });
      }

      // Generate a new summary
      console.log(
        `Generating new summary for content length: ${content.length}`
      );
      const summary = await generateSummary(content, metadata);

      if (!summary.fullSummary) {
        return res.status(500).json({
          success: false,
          error: "Failed to generate summary",
        });
      }

      // Decrement user credits for generating summary
      try {
        await prisma.user.update({
          where: { id: userId },
          data: {
            credits: { decrement: 1 },
          },
        });
      } catch (dbError) {
        console.error("Error updating user credits:", dbError);
        // Continue anyway to return the summary
      }

      // Return the generated summary without saving it to database yet
      return res.json({
        success: true,
        data: {
          ...summary,
          sourceUrl: videoUrl,
          alreadySaved: false, // Indicate this summary is not yet saved
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

// Save summary route - protected by auth
// Enhanced save summary route - more robust with content validation
router.post(
  "/save",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    const userId = req.user!.id;
    const { videoId, title, keyPoints, fullSummary, sourceUrl, transcript } =
      req.body;

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

      // Check if this summary already exists
      const existingSummary = await prisma.summary.findFirst({
        where: {
          videoUrl,
          userId,
        },
      });

      if (existingSummary) {
        // Summary already exists, return it
        return res.json({
          success: true,
          data: {
            id: existingSummary.id,
            createdAt: existingSummary.createdAt,
            alreadySaved: true,
          },
          message: "Summary already saved",
        });
      }

      // Format the summary for storage
      const summaryText = `${title}\n\nKey Points:\n${keyPoints
        .map((point: string) => `- ${point}`)
        .join("\n")}\n\n${fullSummary}`;

      // Create the new summary with all required fields
      const newSummary = await prisma.summary.create({
        data: {
          userId,
          videoUrl,
          summary: summaryText,
          transcript: transcript || "",
          title: title, // Add title field
          videoId: videoId, // Add videoId field
        },
      });

      console.log(`Summary saved with ID: ${newSummary.id}`);

      res.json({
        success: true,
        data: {
          id: newSummary.id,
          createdAt: newSummary.createdAt,
          alreadySaved: true,
        },
        message: "Summary saved successfully",
      });
    } catch (error) {
      console.error("Error saving summary:", error);
      res.status(500).json({
        success: false,
        error: "Failed to save summary",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

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
        select: {
          id: true,
          videoUrl: true,
          summary: true,
          transcript: true,
          createdAt: true,
        },
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

      // Extract YouTube video ID if it exists
      let videoId = null;
      if (summary.videoUrl) {
        const match = summary.videoUrl.match(
          /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/
        );
        if (match && match[1]) {
          videoId = match[1];
        }
      }

      return {
        id: summary.id,
        title,
        keyPoints,
        fullSummary,
        sourceUrl: summary.videoUrl,
        createdAt: summary.createdAt,
        transcript: summary.transcript || "",
        videoId,
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
        select: {
          id: true,
          videoUrl: true,
          summary: true,
          transcript: true,
          createdAt: true,
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

      // Extract YouTube video ID if it exists
      let videoId = null;
      if (summary.videoUrl) {
        const match = summary.videoUrl.match(
          /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/
        );
        if (match && match[1]) {
          videoId = match[1];
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
          transcript: summary.transcript || "",
          videoId,
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

// Get transcript for a summary
router.get(
  "/:id/transcript",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const summaryId = req.params.id;
      console.log(`Getting transcript for summary ID: ${summaryId}`);

      if (!req.user || !req.user.id) {
        console.log("User not authenticated in transcript request");
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Get the summary with transcript
      const summary = await prisma.summary.findUnique({
        where: {
          id: summaryId,
          userId: req.user.id, // Make sure the summary belongs to the user
        },
        select: {
          id: true,
          summary: true,
          transcript: true,
          videoUrl: true,
        },
      });

      if (!summary) {
        console.log(`Summary not found for ID: ${summaryId}`);
        return res.status(404).json({ error: "Summary not found" });
      }

      console.log(
        `Found summary. Transcript length: ${
          summary.transcript?.length || 0
        } characters`
      );

      // Extract title from summary content if needed
      let title = "";
      const titleMatch = summary.summary?.match(/^(.*?)\n/);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }

      // If no transcript is available, try to use a default one for demo purposes
      let transcriptText = summary.transcript || "";
      if (!transcriptText || transcriptText.trim() === "") {
        console.log("No transcript found, using fallback demo transcript");

        // Generate a default transcript based on the summary content
        if (summary.summary) {
          // Extract just the full summary part (not the key points)
          const fullSummaryMatch = summary.summary.match(
            /(?:Key Points:[\s\S]*?\n\n)([\s\S]*?)$/
          );

          if (fullSummaryMatch && fullSummaryMatch[1]) {
            const fullSummary = fullSummaryMatch[1].trim();

            // Create a demo transcript by repeating the summary content in a transcript style
            transcriptText = `This is an auto-generated transcript for demo purposes:\n\n`;

            // Split the summary into sentences and format as a transcript
            const sentences = fullSummary.match(/[^.!?]+[.!?]+/g) || [];
            sentences.forEach((sentence, i) => {
              const time = (i * 30).toString().padStart(2, "0");
              transcriptText += `[00:${time}:00] ${sentence.trim()}\n`;
            });
          }
        }

        if (!transcriptText) {
          transcriptText = "No transcript is available for this video.";
        }
      }

      return res.json({
        success: true,
        title: title, // Include the extracted title
        transcript: transcriptText,
      });
    } catch (error) {
      console.error("Error fetching transcript:", error);
      return res.status(500).json({ error: "Failed to fetch transcript" });
    }
  }
);

export default router;
