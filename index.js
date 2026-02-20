const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json({ limit: '50mb' }));
const TMP = '/tmp';

async function download(url, dest) {
  const res = await axios({ url, responseType: 'stream' });
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(dest);
    res.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

app.post('/assemble', async (req, res) => {
  const id = uuidv4();
  const workDir = path.join(TMP, id);
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const { scenes, audio, output_name } = req.body;
    const scenePaths = [];
    for (let i = 0; i < scenes.length; i++) {
      const p = path.join(workDir, `scene_${i}.mp4`);
      await download(scenes[i], p);
      scenePaths.push(p);
    }
    const audioPath = path.join(workDir, 'audio.mp3');
    await download(audio, audioPath);
    const concatFile = path.join(workDir, 'concat.txt');
    fs.writeFileSync(concatFile, scenePaths.map(p => `file '${p}'`).join('\n'));
    const outputPath = path.join(workDir, `${output_name || 'output'}.mp4`);
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatFile)
        .inputOptions(['-f concat', '-safe 0'])
        .input(audioPath)
        .outputOptions([
          '-c:v libx264', '-c:a aac', '-shortest', '-movflags +faststart',
          '-vf scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2'
        ])
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    const base64 = fs.readFileSync(outputPath).toString('base64');
    fs.rmSync(workDir, { recursive: true, force: true });
    res.json({ success: true, video_base64: base64, filename: `${output_name || 'output'}.mp4` });
  } catch (err) {
    fs.rmSync(workDir, { recursive: true, force: true });
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.listen(3000, () => console.log('FFmpeg server running on port 3000'));
