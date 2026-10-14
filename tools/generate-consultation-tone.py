#!/usr/bin/env python3
"""Original SOLVIA call chime. No samples or external music; reproducible PCM synthesis."""
import base64
import io
import math
import struct
import wave
from pathlib import Path

RATE = 24000
DURATION = 5.8
NOTES = [(0.12,440.0),(0.43,554.365),(0.74,659.255),(1.12,493.883),
         (1.50,739.989),(1.86,659.255),(3.02,440.0),(3.34,554.365),
         (3.66,659.255),(4.02,739.989),(4.40,659.255)]
samples=[]
for n in range(int(RATE*DURATION)):
    t=n/RATE
    value=0.0
    for start,freq in NOTES:
        dt=t-start
        if 0 <= dt < 1.25:
            envelope=min(dt/0.012,1.0)*math.exp(-dt*4.1)*min((1.25-dt)/0.12,1.0)
            value+=envelope*(math.sin(2*math.pi*freq*dt)+0.22*math.sin(2*math.pi*freq*2.003*dt)+0.06*math.sin(2*math.pi*freq*3*dt))
    samples.append(value)
peak=max(abs(x) for x in samples)
output=io.BytesIO()
with wave.open(output,'wb') as wav:
    wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(RATE)
    wav.writeframes(b''.join(struct.pack('<h',round(x/peak*24000)) for x in samples))
root=Path(__file__).resolve().parents[1]
(root/'assets/solvia-consultation.wav.b64').write_text(base64.b64encode(output.getvalue()).decode()+'\n')
print(f'Original chime: {DURATION}s, mono {RATE} Hz, peak -2.7 dBFS')
