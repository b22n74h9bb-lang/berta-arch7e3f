import { useEffect, useRef, useState } from "react";
import { ArrowUp, LoaderCircle, Mic, ScreenShare, Square, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import type { ChatMessage } from "@/types/berta";
import { BertaMark } from "./BertaMark";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

const suggestions = ["Inventory mission data", "Plan the first dataset review", "Explain current boundaries"];

export function ChatPanel({ messages, voiceReplies }: { messages: ChatMessage[]; voiceReplies: boolean }) {
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [screenOpen, setScreenOpen] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sendRef = useRef<(content: string) => void>(() => undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const utils = trpc.useUtils();
  const sendChat = trpc.berta.sendChat.useMutation({
    onSuccess: ({ reply }) => {
      void utils.berta.bootstrap.invalidate();
      if (voiceReplies && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(reply);
        utterance.rate = 1.02;
        window.speechSynthesis.speak(utterance);
      }
    },
    onError: (error) => toast.error(error.message),
  });
  const sendMessage = (raw: string) => {
    const content = raw.trim();
    if (!content || sendChat.isPending) return;
    setInput("");
    sendChat.mutate({ content });
  };
  sendRef.current = sendMessage;

  useEffect(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceSupported(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) sendRef.current(transcript);
    };
    recognition.onerror = (event) => {
      setListening(false);
      if (event.error !== "aborted") toast.error(`Voice input: ${event.error}. You can keep typing instead.`);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sendChat.isPending]);
  useEffect(() => {
    if (videoRef.current && screenStream) videoRef.current.srcObject = screenStream;
  }, [screenStream, screenOpen]);

  const stopScreen = () => {
    screenStream?.getTracks().forEach((track) => track.stop());
    setScreenStream(null);
    setScreenOpen(false);
  };
  const startScreen = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error("Screen capture is not supported in this browser. On iPhone, support depends on the iOS version and browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      stream.getVideoTracks()[0]?.addEventListener("ended", stopScreen);
      setScreenStream(stream);
      setScreenOpen(true);
    } catch (error) {
      if (error instanceof Error && error.name !== "NotAllowedError") toast.error("Screen capture could not start.");
    }
  };
  const toggleListening = () => {
    if (!voiceSupported || !recognitionRef.current) {
      toast.error("Voice recognition is unavailable here. Type your message, or open the app in a supported browser.");
      return;
    }
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch {
      toast.error("The microphone is already busy. Wait a moment and try again.");
    }
  };

  return (
    <section className="console-grid" aria-label="Berta voice and chat console">
      <div className="voice-stage">
        <div className="scanlines" aria-hidden="true" />
        <div className="voice-stage__top">
          <span className="micro-label">BERTA / VOICE LINK</span>
          <span className={`live-badge ${listening ? "is-listening" : ""}`}>
            <span className="status-dot" />
            {listening ? "LISTENING" : sendChat.isPending ? "THINKING" : "READY"}
          </span>
        </div>
        <div className="voice-stage__center">
          <button
            type="button"
            className={`voice-orb ${listening ? "is-listening" : ""}`}
            onClick={toggleListening}
            aria-label={listening ? "Stop voice input" : "Start voice input"}
          >
            <BertaMark size={94} active={listening || sendChat.isPending} />
            <span className="voice-orb__icon">
              {listening ? <Square size={18} fill="currentColor" /> : <Mic size={23} />}
            </span>
          </button>
          <div className="voice-copy">
            <h1>{listening ? "I’m listening." : "Talk to Berta."}</h1>
            <p>{listening ? "Speak naturally. Your final transcript will be sent." : "Voice, text, and mission control—in one bounded workspace."}</p>
          </div>
        </div>
        <div className="suggestion-row" aria-label="Suggested prompts">
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => sendMessage(suggestion)} disabled={sendChat.isPending}>
              {suggestion}
            </button>
          ))}
        </div>
      </div>
      <div className="chat-shell">
        <div className="chat-header">
          <div>
            <span className="micro-label">MISSION CHANNEL</span>
            <p>ARCH7E3F · encrypted account session</p>
          </div>
          <button type="button" className="icon-button" onClick={startScreen} aria-label="Preview a shared screen" title="Local screen preview">
            <ScreenShare size={18} />
          </button>
        </div>
        <div className="message-list" ref={scrollRef} aria-live="polite">
          {messages.filter((message) => message.role !== "system").map((message) => (
            <article key={message.id} className={`message ${message.role === "user" ? "message--user" : "message--berta"}`}>
              <span className="message__role">{message.role === "user" ? "YOU" : "BERTA"}</span>
              <p>{message.content}</p>
            </article>
          ))}
          {sendChat.isPending && (
            <div className="message message--berta message--pending">
              <LoaderCircle size={16} className="spin" />
              <span>Berta is reasoning within the mission boundaries…</span>
            </div>
          )}
        </div>
        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendMessage(input);
          }}
        >
          <label htmlFor="berta-message" className="sr-only">Message Berta</label>
          <textarea
            id="berta-message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Give Berta a mission instruction…"
            rows={2}
            maxLength={6000}
          />
          <button type="submit" className="send-button" disabled={!input.trim() || sendChat.isPending} aria-label="Send message">
            {sendChat.isPending ? <LoaderCircle size={19} className="spin" /> : <ArrowUp size={20} />}
          </button>
        </form>
        <p className="composer-note">Enter to send · Shift + Enter for a new line · AI calls use the site owner’s quota</p>
      </div>
      <Dialog open={screenOpen} onOpenChange={(open) => (open ? setScreenOpen(true) : stopScreen())}>
        <DialogContent className="screen-dialog">
          <DialogHeader>
            <DialogTitle>Local screen preview</DialogTitle>
            <DialogDescription>
              This stream stays in your browser. Berta does not receive frames until a separate visual relay is connected.
            </DialogDescription>
          </DialogHeader>
          <video ref={videoRef} autoPlay muted playsInline className="screen-preview" />
          <button type="button" className="button button--secondary" onClick={stopScreen}>
            <X size={16} /> Stop sharing
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
