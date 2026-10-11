const multer = require("multer");

const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
        fields: 0,
        parts: 1
    },
    fileFilter: (req, file, callback) => {
        const allowed = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/avif"
        ];

        if (!allowed.includes(file.mimetype)) {
            const error = new Error("Only JPEG, PNG, WebP, and AVIF images are accepted.");
            error.status = 415;
            return callback(error);
        }

        callback(null, true);
    }
});

function uploadProductImageMiddleware(req, res, next) {
    upload.single("image")(req, res, (error) => {
        if (!error) return next();

        if (error instanceof multer.MulterError) {
            const tooLarge = error.code === "LIMIT_FILE_SIZE";

            return res.status(tooLarge ? 413 : 400).json({
                success: false,
                message: tooLarge
                    ? "Image exceeds the 5 MB limit."
                    : "The upload is invalid or contains too many fields."
            });
        }

        return res.status(error.status || 400).json({
            success: false,
            message: error.status === 415
                ? error.message
                : "The image upload request is invalid."
        });
    });
}

module.exports = { uploadProductImageMiddleware };