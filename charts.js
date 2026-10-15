const observers = new WeakMap();
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export function clearTrendChart(target) {
  observers.get(target)?.disconnect();
  observers.delete(target);
  target.onpointerleave = null;
  target.onfocusout = null;
}

export function renderTrendChart(target, months) {
  clearTrendChart(target);
  const draw = () => {
    const width = Math.max(220, target.clientWidth || 640), height = 250;
    const left = 46, right = 15, top = 26, bottom = 34;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const highest = Math.max(1, ...months.flatMap(month => [month.income, month.expense]));
    const magnitude = 10 ** Math.floor(Math.log10(highest));
    const maximum = Math.ceil(highest / magnitude) * magnitude;
    const points = type => months.map((month, i) => ({ x: left + plotWidth * i / (months.length - 1), y: top + plotHeight * (1 - month[type] / maximum) }));
    const path = values => values.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
    const incoming = points("income"), outgoing = points("expense");
    target.innerHTML = `<svg class="trend-chart" viewBox="0 0 ${width} ${height}" aria-hidden="true"><defs><linearGradient id="incomeArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".16"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>${[0, .25, .5, .75, 1].map(tick => {
      const y = top + plotHeight * (1 - tick);
      return `<line class="chart-gridline" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"/><text class="axis-label" x="${left - 10}" y="${y + 4}" text-anchor="end">${compact.format(maximum * tick)}</text>`;
    }).join("")}<path class="chart-area-fill" d="${path(incoming)} L${width - right},${height - bottom} L${left},${height - bottom} Z"/><line class="chart-crosshair" x1="0" x2="0" y1="${top}" y2="${height - bottom}" visibility="hidden"/><path class="chart-line income-line" d="${path(incoming)}"/><path class="chart-line expense-line" d="${path(outgoing)}"/>${incoming.map((p, i) => `<g><circle class="chart-point income-point" data-point="${i}" cx="${p.x}" cy="${p.y}" r="3.5"><title>Entradas em ${months[i].label}: ${money.format(months[i].income)}</title></circle><text class="month-label" x="${p.x}" y="${height - 7}" text-anchor="middle">${months[i].label}</text></g>`).join("")}${outgoing.map((p, i) => `<circle class="chart-point expense-point" data-point="${i}" cx="${p.x}" cy="${p.y}" r="3.5"><title>Despesas em ${months[i].label}: ${money.format(months[i].expense)}</title></circle>`).join("")}</svg><div class="chart-targets" role="group" aria-label="Valores mensais. Use as setas para navegar.">${months.map((month, i) => {
      const x = incoming[i].x;
      const start = i === 0 ? left - 12 : x - plotWidth / (months.length - 1) / 2;
      const end = i === months.length - 1 ? width - right + 12 : x + plotWidth / (months.length - 1) / 2;
      return `<button type="button" class="chart-hit" data-chart-month="${i}" style="left:${start / width * 100}%;width:${(end - start) / width * 100}%" aria-label="${month.fullLabel}. Entradas: ${money.format(month.income)}. Despesas: ${money.format(month.expense)}. Saldo: ${money.format(month.income - month.expense)}."></button>`;
    }).join("")}</div><div class="chart-tooltip hidden" role="status" aria-live="polite"></div>`;
    const tooltip = target.querySelector(".chart-tooltip");
    const crosshair = target.querySelector(".chart-crosshair");
    const buttons = [...target.querySelectorAll(".chart-hit")];
    const hide = () => { tooltip.classList.add("hidden"); crosshair.setAttribute("visibility", "hidden"); target.querySelectorAll(".chart-point").forEach(point => point.setAttribute("r", "3.5")); };
    const show = index => {
      const month = months[index];
      tooltip.innerHTML = `<strong>${month.fullLabel}</strong><div><span><i class="dot income-dot"></i>Entradas</span><b>${money.format(month.income)}</b></div><div><span><i class="dot expense-dot"></i>Despesas</span><b>${money.format(month.expense)}</b></div><div class="tooltip-balance"><span>Saldo do mês</span><b>${money.format(month.income - month.expense)}</b></div>`;
      tooltip.classList.remove("hidden");
      tooltip.style.left = `${Math.max(0, Math.min(width - tooltip.offsetWidth, incoming[index].x - tooltip.offsetWidth / 2))}px`;
      crosshair.setAttribute("x1", incoming[index].x); crosshair.setAttribute("x2", incoming[index].x); crosshair.setAttribute("visibility", "visible");
      target.querySelectorAll(".chart-point").forEach(point => point.setAttribute("r", Number(point.dataset.point) === index ? "5" : "3.5"));
    };
    buttons.forEach((button, index) => {
      button.addEventListener("pointerenter", () => show(index));
      button.addEventListener("focus", () => show(index));
      button.addEventListener("click", () => show(index));
      button.addEventListener("keydown", event => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? months.length - 1 : Math.max(0, Math.min(months.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
          buttons[next].focus();
        }
        if (event.key === "Escape") hide();
      });
    });
    target.onpointerleave = () => { if (!target.contains(document.activeElement)) hide(); };
    target.onfocusout = event => { if (!target.contains(event.relatedTarget)) hide(); };
  };
  draw();
  let previousWidth = target.clientWidth;
  const observer = new ResizeObserver(() => {
    if (target.clientWidth && target.clientWidth !== previousWidth) { previousWidth = target.clientWidth; draw(); }
  });
  observer.observe(target);
  observers.set(target, observer);
}
