import multer from 'multer';
import path from 'path';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype !== 'text/csv' && !file.originalname.endsWith('.csv')) {
    return cb(new Error('Only CSV files are allowed'), false);
  }
  // Check for path traversal in filename
  if (file.originalname.includes('..') || file.originalname.includes('/')) {
    return cb(new Error('Invalid filename'), false);
  }
  cb(null, true);
};

export const uploadCsv = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: (parseInt(process.env.UPLOAD_MAX_SIZE_MB) || 50) * 1024 * 1024,
  },
});
