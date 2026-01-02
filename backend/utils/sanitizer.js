// ✅ SECURITY FIX: Input sanitization utilities
const validator = require('validator');
const xss = require('xss');

class InputSanitizer {
    /**
     * Sanitize string input - removes HTML/scripts
     */
    static sanitizeString(input, options = {}) {
        if (!input) return input;
        if (typeof input !== 'string') return String(input);
        
        // Trim whitespace
        let sanitized = validator.trim(input);
        
        // XSS protection
        sanitized = xss(sanitized);
        
        // Optionally limit length
        if (options.maxLength && sanitized.length > options.maxLength) {
            sanitized = sanitized.substring(0, options.maxLength);
        }
        
        return sanitized;
    }
    
    /**
     * Sanitize email address
     */
    static sanitizeEmail(email) {
        if (!email) return email;
        return validator.normalizeEmail(email.toLowerCase());
    }
    
    /**
     * Sanitize phone number
     */
    static sanitizePhone(phone) {
        if (!phone) return phone;
        // Remove all non-numeric characters except + - ( ) space
        return phone.replace(/[^0-9+\-() ]/g, '');
    }
    
    /**
     * Sanitize URL
     */
    static sanitizeURL(url) {
        if (!url) return url;
        if (!validator.isURL(url, { protocols: ['http', 'https'], require_protocol: true })) {
            throw new Error('Invalid URL format');
        }
        return url;
    }
    
    /**
     * Validate and sanitize integer
     */
    static sanitizeInt(value, options = {}) {
        const num = parseInt(value, 10);
        if (isNaN(num)) {
            throw new Error('Invalid integer value');
        }
        if (options.min !== undefined && num < options.min) {
            throw new Error(`Value must be at least ${options.min}`);
        }
        if (options.max !== undefined && num > options.max) {
            throw new Error(`Value must be at most ${options.max}`);
        }
        return num;
    }
    
    /**
     * Sanitize hostname
     */
    static sanitizeHostname(hostname) {
        if (!hostname) return hostname;
        hostname = hostname.toLowerCase();
        if (!validator.isFQDN(hostname)) {
            throw new Error('Invalid hostname format');
        }
        return hostname;
    }
    
    /**
     * Sanitize username (alphanumeric, underscore, hyphen only)
     */
    static sanitizeUsername(username) {
        if (!username) return username;
        username = validator.trim(username);
        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
            throw new Error('Username can only contain letters, numbers, underscores, and hyphens');
        }
        if (username.length < 3 || username.length > 30) {
            throw new Error('Username must be between 3 and 30 characters');
        }
        return username.toLowerCase();
    }
    
    /**
     * Sanitize object - recursively sanitize all string values
     */
    static sanitizeObject(obj, options = {}) {
        if (!obj || typeof obj !== 'object') return obj;
        
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                sanitized[key] = this.sanitizeString(value, options);
            } else if (typeof value === 'object' && value !== null) {
                sanitized[key] = this.sanitizeObject(value, options);
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
}

module.exports = InputSanitizer;

