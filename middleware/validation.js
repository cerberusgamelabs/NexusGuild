// Proprietary — Cerberus Game Labs. See LICENSE for terms.
// File Location: /middleware/validation.js

import { body, param, validationResult } from "express-validator";

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    next();
};

// Validation rules
const validateRegister = [
    body('username')
        .isLength({ min: 3, max: 32 })
        .withMessage('Username must be between 3 and 32 characters')
        .matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Username can only contain letters, numbers, and underscores'),
    body('email')
        .isEmail()
        .withMessage('Must be a valid email address'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long'),
    validate
];

const validateLogin = [
    body('email')
        .isEmail()
        .withMessage('Must be a valid email address'),
    body('password')
        .notEmpty()
        .withMessage('Password is required'),
    validate
];

const validateServer = [
    body('name')
        .isLength({ min: 1, max: 100 })
        .withMessage('Server name must be between 1 and 100 characters')
        .trim(),
    validate
];

const validateChannel = [
    body('name')
        .isLength({ min: 1, max: 100 })
        .withMessage('Channel name must be between 1 and 100 characters')
        .trim(),
    body('type')
        .optional()
        .isIn(['text', 'voice', 'announcement', 'forum', 'media'])
        .withMessage('Invalid channel type'),
    validate
];

const validateMessage = [
    body('content')
        .optional({ checkFalsy: true })
        .isLength({ max: 2000 })
        .withMessage('Message must be under 2000 characters')
        .trim(),
    (req, res, next) => {
        // Allow empty content if files are attached
        if (!req.body.content && (!req.files || req.files.length === 0)) {
            return res.status(400).json({ error: 'Message must have content or attachments' });
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

const validateRole = [
    body('name')
        .isLength({ min: 1, max: 100 })
        .withMessage('Role name must be between 1 and 100 characters')
        .trim(),
    body('color')
        .optional()
        .matches(/^#[0-9A-F]{6}$/i)
        .withMessage('Color must be a valid hex color'),
    validate
];

export {
    validateRegister,
    validateLogin,
    validateServer,
    validateChannel,
    validateMessage,
    validateRole,
    validate
};