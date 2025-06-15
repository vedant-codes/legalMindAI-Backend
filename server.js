import express from 'express';
import cors from 'cors';
import fileuploadRoutes from './routes/fileuploadRoutes.js'
import summaryRoutes from './routes/summaryRoutes.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', fileuploadRoutes);
app.use('/api', summaryRoutes);

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
