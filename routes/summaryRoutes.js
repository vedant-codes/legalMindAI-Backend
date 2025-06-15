import express, { Router } from 'express'
import cors from 'cors';
import bodyparser from 'body-parser'
import dotenv from 'dotenv'
import { GoogleGenerativeAI } from "@google/generative-ai";




dotenv.config();




const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);



const router = express.Router();

router.get("/", (req, res) => {
  

  if (!process.env.GEMINI_API_KEY) {
    res.json({ message: "Server is not running!" });
  } else {
    res.json({ message: "Server is running!" });
  }
  
});


router.post("/generate-summary", async (req, res) => {
  const userPrompt = req.body.prompt;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent(
      `Read the following legal contract text and extract the following:
      - A simple summary in plain English. (string)
      - parties - object{name,role}
      - dates - object{ date(yyyy-mm-dd),desc}
      - financialTerms - object (amount,date(yyyy-mm-dd),desc)
      - obligations - object{name,role}
      - riskyClauses - object {clause,description,risk(low/medium/high onlyy)} 
      
      Respond strictly in valid JSON (without explanations or extra comments).
      
      Here is the contract:
      ${userPrompt}`
    );

    let output = result.response.candidates[0].content.parts[0].text.trim();

    // Remove the ```json and ``` if present
    if (output.startsWith("```json")) {
      output = output.replace(/^```json/, "").replace(/```$/, "").trim();
    }

    const jsonResponse = JSON.parse(output);

    res.json({ result: jsonResponse });

  } catch (error) {
    res.status(500).json({ error: "Failed", details: error.message });
  }
});

router.post("/qna", async (req, res) => {
  const userPrompt = req.body.prompt;
  const schema = req.body.schema;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent(
      `On the basis of the contract's schema: ${JSON.stringify(schema)},
      Answer the question as text.
      
      Here is the question:
      ${userPrompt}`
    );

    let output = result.response.candidates[0].content.parts[0].text.trim();
    res.json({ result: output });

  } catch (error) {
    res.status(500).json({ error: "Failed", details: error.message });
  }
});

export default router



