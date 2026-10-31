// lib/ffsafe.js — how ffmpeg and ffprobe may open a file someone uploaded.
// Put these before the uploaded file's -i. Without them ffmpeg guesses the format from the contents,
// so a "video" that is really a playlist (DASH, HLS…) makes the server fetch web addresses or read
// other files on its disk. With them it only reads real video containers, and only from local files.
export const VIDEO_FORMATS = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,mpegts';
export const VIDEO_IN = ['-protocol_whitelist', 'file', '-format_whitelist', VIDEO_FORMATS];
export const IMAGE_IN = ['-protocol_whitelist', 'file', '-format_whitelist', 'png_pipe,jpeg_pipe,webp_pipe,image2'];
