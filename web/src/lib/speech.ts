import { tokenizeSpoken } from './normalize';

export type SpeechHandlers = {
  onFinal: (words: string[], text: string) => void;
  onInterim: (words: string[], text: string) => void;
  onListening: (listening: boolean) => void;
  onError: (code: string, message: string) => void;
};

/** Contrato de motor de STT: hoje Web Speech; amanhã Vosk/Whisper local pelo backend. */
export interface SpeechEngine {
  start(): void;
  stop(): void;
}

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

function ctor(): (new () => Recognition) | null {
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = () => ctor() !== null;

const ERRORS: Record<string, string> = {
  'not-allowed': 'Permissão de microfone negada.',
  'service-not-allowed': 'O navegador bloqueou o serviço de reconhecimento de fala.',
  'audio-capture': 'Nenhum microfone encontrado.',
  network: 'Falha de rede: o Web Speech do Chrome/Edge processa a fala em nuvem.',
  'language-not-supported': 'Idioma não suportado pelo reconhecimento de fala.',
};

export class WebSpeechEngine implements SpeechEngine {
  private rec: Recognition | null = null;
  private wanted = false;
  private finalsSeen = 0;

  constructor(private lang: string, private h: SpeechHandlers) {}

  start() {
    const C = ctor();
    if (!C) {
      this.h.onError('unsupported', 'Este navegador não tem Web Speech API. Use Chrome ou Edge.');
      return;
    }
    if (!this.rec) this.rec = this.create(C);
    this.wanted = true;
    this.safeStart();
  }

  stop() {
    this.wanted = false;
    try {
      this.rec?.stop();
    } catch {
      /* já parado */
    }
  }

  private safeStart() {
    this.finalsSeen = 0;
    try {
      this.rec?.start();
    } catch {
      /* start duplicado lança InvalidStateError; ignorável */
    }
  }

  private create(C: new () => Recognition): Recognition {
    const rec = new C();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => this.h.onListening(true);
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text: string = r[0]?.transcript ?? '';
        if (r.isFinal) {
          if (i >= this.finalsSeen) {
            this.finalsSeen = i + 1;
            this.h.onFinal(tokenizeSpoken(text), text.trim());
          }
        } else {
          interim += ` ${text}`;
        }
      }
      this.h.onInterim(tokenizeSpoken(interim), interim.trim());
    };
    rec.onerror = (e: any) => {
      const code = String(e.error ?? 'unknown');
      if (code === 'no-speech' || code === 'aborted') return;
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') this.wanted = false;
      this.h.onError(code, ERRORS[code] ?? `Erro no reconhecimento: ${code}`);
    };
    // O Chrome encerra a sessão após silêncio/~60 s; reinicia enquanto o usuário quiser ouvir.
    rec.onend = () => {
      this.h.onInterim([], '');
      if (this.wanted) setTimeout(() => this.wanted && this.safeStart(), 120);
      else this.h.onListening(false);
    };
    return rec;
  }
}
