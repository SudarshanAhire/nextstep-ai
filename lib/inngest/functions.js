import { db } from "@/lib/prisma";
import { inngest } from "./client";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

export const generateIndustryInsights = inngest.createFunction(
  { name: "Generate Industry Insights" },
  { cron: "0 0 * * 0" }, // Run every Sunday at midnight
  async ({ event, step }) => {
    const industries = await step.run("Fetch industries", async () => {
      return await db.industryInsight.findMany({
        select: { industry: true },
      });
    });

    for (const { industry } of industries) {
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
          Use UPPERCASE values for enums (e.g. HIGH, MEDIUM, LOW).
          Include at least 5 common roles for salary ranges.
          Growth rate should be a percentage.
          Include at least 5 skills and trends.
        `;

      try {
        const res = await step.ai.wrap(
          "gemini",
          async (p) => {
            return await model.generateContent(p);
          },
          prompt
        );

        // Be resilient to different response shapes from the AI SDK
        const response = res?.response ?? res;
        let text = "";

        if (!response) {
          throw new Error("No response from AI model");
        }

        if (typeof response.text === "function") {
          text = response.text();
        } else if (response.candidates && response.candidates[0]) {
          // Support multiple candidate shapes
          const cand = response.candidates[0];
          text = cand?.content?.parts?.[0]?.text ?? cand?.content?.text ?? "";
        } else if (response.output?.text) {
          text = response.output.text;
        } else {
          text = JSON.stringify(response);
        }

        const cleanedText = String(text).replace(/```(?:json)?\n?/g, "").trim();

        let insights;
        try {
          insights = JSON.parse(cleanedText);
        } catch (err) {
          // If parsing fails, log the raw output and skip this industry
          console.error(`Failed to parse insights for ${industry}:`, cleanedText, err.message);
          continue;
        }

        // Normalize enum values to match Prisma schema
        if (insights.demandLevel) insights.demandLevel = String(insights.demandLevel).toUpperCase();
        if (insights.marketOutlook) insights.marketOutlook = String(insights.marketOutlook).toUpperCase();

        await step.run(`Update ${industry} insights`, async () => {
          await db.industryInsight.update({
            where: { industry },
            data: {
              ...insights,
              lastUpdated: new Date(),
              nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          });
        });
      } catch (err) {
        // Log the error and continue processing other industries rather than cancelling the whole job
        console.error(`Error generating/updating insights for industry=${industry}:`, err);
        continue;
      }
    }
  }
);