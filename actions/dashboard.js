"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
// Lazily get a generative model to avoid importing the SDK at module load time
async function getGenerativeModel() {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
}

export const generateAIInsights = async (industry) => {
  const prompt = `
          Analyze the current state of the ${industry} industry and provide insights in ONLY the following JSON format without any additional notes or explanations:
          {
            "salaryRanges": [
              { "role": "string", "min": number, "max": number, "median": number, "location": "string" }
            ],
            "growthRate": number,
            "demandLevel": "HIGH" | "MEDIUM" | "LOW",
            "topSkills": ["skill1", "skill2"],
            "marketOutlook": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
            "keyTrends": ["trend1", "trend2"],
            "recommendedSkills": ["skill1", "skill2"]
          }
          
          IMPORTANT: Return ONLY the JSON. No additional text, notes, or markdown formatting.
          Include at least 5 common roles for salary ranges.
          Growth rate should be a percentage.
          Include at least 5 skills and trends.
        `;

  const result = await getGenerativeModel().then((m) => m.generateContent(prompt));
  const response = result.response ?? result;
  const text = typeof response.text === "function" ? response.text() : String(response);
  const cleanedText = text.replace(/```(?:json)?\n?/g, "").trim();

  const insights = JSON.parse(cleanedText);
  
  // Normalize enum values to uppercase to match Prisma schema
  insights.demandLevel = insights.demandLevel?.toUpperCase() || "MEDIUM";
  insights.marketOutlook = insights.marketOutlook?.toUpperCase() || "NEUTRAL";

  return insights;
};

export async function getIndustryInsights() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    include: {
      industryInsight: true,
    },
  });

  if (!user) throw new Error("User not found");

  if (!user.industry) {
    throw new Error("User industry is not set. Please update your profile first.");
  }

  // If no insights exist, generate them
  if (!user.industryInsight) {
    const insights = await generateAIInsights(user.industry);

    const industryInsight = await db.industryInsight.create({
      data: {
        industry: user.industry,
        ...insights,
        nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return industryInsight;
  }

  return user.industryInsight;
}