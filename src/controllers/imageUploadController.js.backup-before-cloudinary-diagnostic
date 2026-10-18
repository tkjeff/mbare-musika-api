const cloudinary = require("cloudinary").v2;
const pool = require("../config/db");
const { Readable } = require("stream");

let configured = false;

function configureCloudinary() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
        return false;
    }

    if (!configured) {
        cloudinary.config({
            cloud_name: cloudName,
            api_key: apiKey,
            api_secret: apiSecret,
            secure: true
        });
        configured = true;
    }

    return true;
}

function detectImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
        return null;
    }

    // JPEG
    if (
        buffer[0] === 0xFF &&
        buffer[1] === 0xD8 &&
        buffer[2] === 0xFF
    ) {
        return "jpg";
    }

    // PNG
    if (
        buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(
            Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
        )
    ) {
        return "png";
    }

    // WebP
    if (
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
        return "webp";
    }

    // AVIF / AVIS ISO-BMFF brands
    if (
        buffer.toString("ascii", 4, 8) === "ftyp" &&
        ["avif", "avis"].includes(buffer.toString("ascii", 8, 12))
    ) {
        return "avif";
    }

    return null;
}

async function uploadProductImage(req, res, next) {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({
                success: false,
                message: "Select a product image before uploading."
            });
        }

        const imageFormat = detectImage(req.file.buffer);

        if (!imageFormat) {
            return res.status(415).json({
                success: false,
                message: "Unsupported image content. Use a genuine JPEG, PNG, WebP, or AVIF image."
            });
        }

        // Confirm seller approval before sending the file to Cloudinary.
        const seller = await pool.query(
            `SELECT approval_status
             FROM seller_profiles
             WHERE user_id = $1
             LIMIT 1`,
            [req.user.sub]
        );

        if (
            seller.rowCount === 0 ||
            seller.rows[0].approval_status !== "APPROVED"
        ) {
            return res.status(403).json({
                success: false,
                message: "Your seller account must be approved before uploading product images."
            });
        }

        if (!configureCloudinary()) {
            return res.status(503).json({
                success: false,
                message: "Image uploads are not configured. Contact the marketplace administrator."
            });
        }

        const uploadResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder: "mbare-musika/products",
                    resource_type: "image",
                    allowed_formats: ["jpg", "png", "webp", "avif"],
                    unique_filename: true,
                    overwrite: false,
                    transformation: [
                        { width: 1600, height: 1600, crop: "limit" }
                    ]
                },
                (error, result) => {
                    if (error) return reject(error);
                    if (!result || !result.secure_url || !result.public_id) {
                        return reject(new Error("Cloudinary returned an incomplete upload result."));
                    }
                    resolve(result);
                }
            );

            Readable.from(req.file.buffer).pipe(uploadStream);
        });

        return res.status(201).json({
            success: true,
            message: "Product image uploaded successfully.",
            imageUrl: uploadResult.secure_url,
            publicId: uploadResult.public_id,
            format: uploadResult.format,
            bytes: uploadResult.bytes
        });
    } catch (error) {
        // Do not expose provider credentials or raw provider error details.
        console.error("Product image upload failed:", error.http_code || error.code || "UPLOAD_ERROR");

        if (error.http_code === 401 || error.http_code === 403) {
            return res.status(502).json({
                success: false,
                message: "The image service rejected its configuration. Check the server credentials."
            });
        }

        return res.status(502).json({
            success: false,
            message: "The product image could not be uploaded. Please try again."
        });
    }
}

module.exports = { uploadProductImage };