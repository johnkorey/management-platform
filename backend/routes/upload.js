// =====================================================
// File Upload Routes (Admin Only)
// =====================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { authenticate, requireAdmin } = require('../middleware/auth');
const pool = require('../db');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads/evilginx-builds');
        try {
            await fs.mkdir(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const hash = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname);
        cb(null, `evilginx-${timestamp}-${hash}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB max
    },
    fileFilter: (req, file, cb) => {
        const allowedExts = ['.zip', '.tar', '.gz', '.tgz', '.tar.gz'];
        const ext = path.extname(file.originalname).toLowerCase();
        
        if (allowedExts.includes(ext) || file.originalname.endsWith('.tar.gz')) {
            cb(null, true);
        } else {
            cb(new Error('Only .zip, .tar.gz, .tgz files are allowed'));
        }
    }
});

// =====================================================
// POST /api/upload/evilginx-build
// Upload Evilginx source code (Admin only)
// =====================================================

router.post('/evilginx-build', authenticate, requireAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const { version, description } = req.body;

        if (!version) {
            // Clean up uploaded file
            await fs.unlink(req.file.path).catch(() => {});
            return res.status(400).json({ success: false, message: 'Version is required' });
        }

        // Store build info in database
        const result = await pool.query(`
            INSERT INTO evilginx_builds (
                version,
                description,
                filename,
                file_path,
                file_size,
                file_hash,
                uploaded_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `, [
            version,
            description || null,
            req.file.filename,
            req.file.path,
            req.file.size,
            crypto.createHash('sha256').update(await fs.readFile(req.file.path)).digest('hex'),
            req.user.id
        ]);

        // Mark this as the active build
        await pool.query(`
            UPDATE evilginx_builds 
            SET is_active = false 
            WHERE id != $1
        `, [result.rows[0].id]);

        await pool.query(`
            UPDATE evilginx_builds 
            SET is_active = true 
            WHERE id = $1
        `, [result.rows[0].id]);

        res.json({
            success: true,
            message: 'Build uploaded successfully',
            data: {
                id: result.rows[0].id,
                version: result.rows[0].version,
                filename: result.rows[0].filename,
                size: result.rows[0].file_size,
                hash: result.rows[0].file_hash,
                uploadedAt: result.rows[0].created_at
            }
        });

    } catch (error) {
        console.error('Upload error:', error);
        
        // Clean up file on error
        if (req.file) {
            await fs.unlink(req.file.path).catch(() => {});
        }

        res.status(500).json({ 
            success: false, 
            message: error.message || 'Upload failed' 
        });
    }
});

// =====================================================
// GET /api/upload/evilginx-builds
// List all uploaded builds
// =====================================================

router.get('/evilginx-builds', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                b.*,
                u.username as uploaded_by_username,
                u.email as uploaded_by_email
            FROM evilginx_builds b
            LEFT JOIN users u ON b.uploaded_by = u.id
            ORDER BY b.created_at DESC
        `);

        res.json({
            success: true,
            data: result.rows.map(build => ({
                id: build.id,
                version: build.version,
                description: build.description,
                filename: build.filename,
                size: build.file_size,
                hash: build.file_hash,
                isActive: build.is_active,
                uploadedBy: {
                    username: build.uploaded_by_username,
                    email: build.uploaded_by_email
                },
                uploadedAt: build.created_at
            }))
        });

    } catch (error) {
        console.error('List builds error:', error);
        res.status(500).json({ success: false, message: 'Failed to list builds' });
    }
});

// =====================================================
// GET /api/upload/evilginx-builds/active
// Get the currently active build
// =====================================================

router.get('/evilginx-builds/active', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                b.*,
                u.username as uploaded_by_username
            FROM evilginx_builds b
            LEFT JOIN users u ON b.uploaded_by = u.id
            WHERE b.is_active = true
            LIMIT 1
        `);

        if (result.rows.length === 0) {
            return res.json({
                success: true,
                data: null,
                message: 'No active build found'
            });
        }

        res.json({
            success: true,
            data: {
                id: result.rows[0].id,
                version: result.rows[0].version,
                description: result.rows[0].description,
                filename: result.rows[0].filename,
                size: result.rows[0].file_size,
                hash: result.rows[0].file_hash,
                uploadedBy: result.rows[0].uploaded_by_username,
                uploadedAt: result.rows[0].created_at
            }
        });

    } catch (error) {
        console.error('Get active build error:', error);
        res.status(500).json({ success: false, message: 'Failed to get active build' });
    }
});

// =====================================================
// POST /api/upload/evilginx-builds/:id/activate
// Set a build as active (Admin only)
// =====================================================

router.post('/evilginx-builds/:id/activate', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Deactivate all builds
        await pool.query('UPDATE evilginx_builds SET is_active = false');

        // Activate the selected build
        const result = await pool.query(`
            UPDATE evilginx_builds 
            SET is_active = true 
            WHERE id = $1
            RETURNING *
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Build not found' });
        }

        res.json({
            success: true,
            message: 'Build activated successfully',
            data: {
                id: result.rows[0].id,
                version: result.rows[0].version
            }
        });

    } catch (error) {
        console.error('Activate build error:', error);
        res.status(500).json({ success: false, message: 'Failed to activate build' });
    }
});

// =====================================================
// DELETE /api/upload/evilginx-builds/:id
// Delete a build (Admin only)
// =====================================================

router.delete('/evilginx-builds/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Get build info
        const buildResult = await pool.query('SELECT * FROM evilginx_builds WHERE id = $1', [id]);
        
        if (buildResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Build not found' });
        }

        const build = buildResult.rows[0];

        // Don't allow deleting active build
        if (build.is_active) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete active build. Activate another build first.' 
            });
        }

        // Delete file from filesystem
        await fs.unlink(build.file_path).catch(err => {
            console.warn('Failed to delete file:', err.message);
        });

        // Delete from database
        await pool.query('DELETE FROM evilginx_builds WHERE id = $1', [id]);

        res.json({
            success: true,
            message: 'Build deleted successfully'
        });

    } catch (error) {
        console.error('Delete build error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete build' });
    }
});

module.exports = router;

