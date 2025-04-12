import { Router } from "express";
import authRoutes from "./auth";
import summaryRoutes from "./summary";
const router = Router();

router.use("/auth", authRoutes);
router.use("/summary", summaryRoutes);

export default router;
