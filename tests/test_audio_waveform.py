"""Testes unitários para o módulo de extração e rotas de waveform de áudio real."""
import os
import math
import struct
import wave
import tempfile
import unittest
from pathlib import Path

from src.media.audio_waveform import (
    extract_waveform_peaks,
    get_waveform_cache_path,
    DEFAULT_SAMPLE_RATE,
    PCM_AUDIO_SAMPLE_RATE
)


class TestAudioWaveform(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Cria um arquivo WAV sintético para teste (2 segundos @ 44100Hz 16-bit mono)
        # Primeiro segundo: tom senoidal puro a 440Hz com amplitude 0.8
        # Segundo segundo: silêncio absoluto (amplitude 0.0)
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.wav_path = Path(cls.temp_dir.name) / "test_synth.wav"
        
        sample_rate = 44100
        duration_s = 2.0
        num_samples = int(sample_rate * duration_s)
        
        with wave.open(str(cls.wav_path), 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)  # 16-bit
            wf.setframerate(sample_rate)
            
            frames = bytearray()
            for i in range(num_samples):
                t = i / sample_rate
                if t < 1.0:
                    # Senóide 440 Hz com amplitude 0.8
                    val = int(0.8 * 32767.0 * math.sin(2 * math.pi * 440 * t))
                else:
                    # Silêncio
                    val = 0
                frames.extend(struct.pack('<h', val))
            wf.writeframes(frames)

    @classmethod
    def tearDownClass(cls):
        cls.temp_dir.cleanup()

    def test_extract_waveform_peaks_real(self):
        """Testa extração de picos e verifica valores de amplitude de sinal e silêncio."""
        res = extract_waveform_peaks(self.wav_path, sample_rate=100)
        
        self.assertNotIn("error", res)
        self.assertEqual(res["sample_rate"], 100)
        self.assertAlmostEqual(res["duration"], 2.0, places=1)
        
        peaks = res["peaks"]
        self.assertGreater(len(peaks), 300)  # ~400 valores (200 pares min/max)
        
        # Primeiro segundo (senóide): deve ter picos próximos de -0.8 e +0.8
        first_sec_peaks = peaks[:190]
        max_val_s1 = max(first_sec_peaks)
        min_val_s1 = min(first_sec_peaks)
        self.assertGreaterEqual(max_val_s1, 0.7)
        self.assertLessEqual(min_val_s1, -0.7)
        
        # Segundo segundo (silêncio): deve ter picos exatamente ou próximos de 0.0
        second_sec_peaks = peaks[220:]
        max_val_s2 = max(second_sec_peaks)
        min_val_s2 = min(second_sec_peaks)
        self.assertAlmostEqual(max_val_s2, 0.0, places=2)
        self.assertAlmostEqual(min_val_s2, 0.0, places=2)

    def test_extract_waveform_missing_file(self):
        """Testa comportamento gracioso para arquivo inexistente."""
        fake_path = Path("c:/nao_existe/arquivo_fantasma.wav")
        res = extract_waveform_peaks(fake_path)
        self.assertEqual(res["duration"], 0.0)
        self.assertEqual(len(res["peaks"]), 0)
        self.assertIn("error", res)

    def test_cache_file_generation(self):
        """Testa gravação e leitura do arquivo JSON de cache."""
        cache_file = Path(self.temp_dir.name) / "cache_test.json"
        res = extract_waveform_peaks(self.wav_path, output_path=cache_file, sample_rate=50)
        
        self.assertTrue(cache_file.exists())
        self.assertGreater(cache_file.stat().st_size, 50)
        self.assertEqual(res["sample_rate"], 50)


if __name__ == "__main__":
    unittest.main()
