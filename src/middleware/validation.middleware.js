import { body, validationResult } from 'express-validator';
import { AppError } from '../utils/errorHandler.js';

export const validateChatRequest = [
  body('question')
    .trim()
    .notEmpty()
    .withMessage('Question is required')
    .isLength({ min: 3, max: 1000 })
    .withMessage('Question must be between 3 and 1000 characters'),
  
  body('documentId')
    .optional()
    .trim()
    .isUUID()
    .withMessage('Invalid document ID format'),
  
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError(errors.array()[0].msg, 400));
    }
    next();
  }
];