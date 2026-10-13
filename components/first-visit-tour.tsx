'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';

const steps = [
  { target: '[data-tour="input"]', title: '在这里描述你的选股想法', detail: '输入指标、阈值或研究想法，也可以点击快捷示例开始。' },
  { target: '[data-tour="conditions"]', title: '系统会转化为可修改的条件', detail: '逐项确认指标、比较方式和阈值，再点击按钮更新筛选。' },
  { target: '[data-tour="results"]', title: '点击“查看依据”了解每个结果', detail: '查看入选与排除原因；手机上可从每家公司卡片进入。' },
];
const storageKey = 'condition-lab-tour-v1';

type Box = { top: number; left: number; width: number; height: number; viewportWidth: number; viewportHeight: number };
export function FirstVisitTour({ restart }: { restart: number }) {
  const [step, setStep] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const finish = () => { try { localStorage.setItem(storageKey, 'true'); } catch { /* Storage may be unavailable; still allow closing. */ } setStep(null); };
  useEffect(() => { try { if (localStorage.getItem(storageKey) !== 'true') setStep(0); } catch { setStep(0); } }, []);
  useEffect(() => { if (restart > 0) setStep(0); }, [restart]);
  useEffect(() => {
    if (step === null) return;
    const target = document.querySelector<HTMLElement>(steps[step].target);
    if (!target) { setStep(null); return; }
    setBox(null);
    target.scrollIntoView({ behavior: 'instant', block: 'center' });
    let frame = 0;
    const measure = () => {
      const rect = target.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      const left = Math.max(8, rect.left - 7), top = Math.max(8, rect.top - 7);
      const right = Math.min(vw - 8, rect.right + 7), bottom = Math.min(vh - 8, rect.bottom + 7);
      setBox({ top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top), viewportWidth: vw, viewportHeight: vh });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule); observer.observe(target);
    window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); };
  }, [step]);
  const active = step !== null;
  useEffect(() => {
    if (!active) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(); }
      if (event.key === 'Tab') {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
        if (!controls.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (!dialogRef.current?.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); first.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previousFocus.current?.focus({ preventScroll: true }); };
  }, [active]);
  useEffect(() => { if (box) dialogRef.current?.querySelector<HTMLButtonElement>('[data-tour-next]')?.focus({ preventScroll: true }); }, [step, !!box]);
  if (step === null || !box) return null;
  const width = Math.min(360, box.viewportWidth - 32), height = 206;
  const top = box.top + box.height + height + 20 < box.viewportHeight ? box.top + box.height + 14
    : box.top > height + 24 ? box.top - height - 14 : Math.max(12, box.viewportHeight - height - 18);
  const left = Math.max(16, Math.min(box.left, box.viewportWidth - width - 16));
  return <div className="tour-layer">
    <div className="tour-shade" style={{ top: 0, left: 0, right: 0, height: box.top }} />
    <div className="tour-shade" style={{ top: box.top + box.height, left: 0, right: 0, bottom: 0 }} />
    <div className="tour-shade" style={{ top: box.top, left: 0, width: box.left, height: box.height }} />
    <div className="tour-shade" style={{ top: box.top, left: box.left + box.width, right: 0, height: box.height }} />
    <div className="tour-spotlight" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} aria-hidden="true" />
    <div ref={dialogRef} className="tour-popover" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-detail" style={{ top, left, width }}>
      <div className="tour-top"><span>快速上手 · {step + 1}/3</span><button aria-label="结束引导" onClick={finish}><X size={17}/></button></div>
      <h2 id="tour-title">{steps[step].title}</h2><p id="tour-detail">{steps[step].detail}</p>
      <div className="tour-bottom"><div className="tour-dots" aria-label={`第 ${step + 1} 步，共 3 步`}>{steps.map((_, index) => <i key={index} className={index === step ? 'current' : ''}/>)}</div><div className="tour-actions">{step > 0 && <button className="text-button" onClick={() => setStep(step - 1)}>上一步</button>}<button data-tour-next className="button primary small" onClick={() => step === 2 ? finish() : setStep(step + 1)}>{step === 2 ? '开始使用' : '下一步'}{step === 2 ? <Check size={14}/> : <ArrowRight size={14}/>}</button></div></div>
    </div>
  </div>;
}
