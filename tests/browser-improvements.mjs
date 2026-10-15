export async function testImprovements(devTools, name, assert) {
  await devTools.evaluate(`(() => {
    const date = new Date().toLocaleDateString('sv-SE');
    const month = date.slice(0, 7);
    const deadline = new Date(new Date().getFullYear() + 1, 11, 31).toLocaleDateString('sv-SE');
    localStorage.setItem('contaai-transactions-v2', JSON.stringify([
      {id:'new-salary',title:'Salário de teste',type:'income',category:'Salário',amount:5000,date,paid:true,account:'Principal'},
      {id:'new-food',title:'Supermercado de teste',type:'expense',category:'Alimentação',amount:900,date,paid:true,account:'Principal'},
      {id:'new-fixed',title:'Internet mensal',type:'expense',category:'Moradia',amount:100,date:month+'-10',paidDate:date,paid:true,recurring:true,account:'Principal'}
    ]));
    localStorage.setItem('contaai-budgets-v1',JSON.stringify([{id:'new-budget',category:'Alimentação',limit:1000}]));
    localStorage.setItem('contaai-goals-v2',JSON.stringify([{id:'new-goal',title:'Viagem planejada',target:12000,saved:3000,deadline,color:'#176bba'}]));
    localStorage.setItem('contaai-ui-state-v1',JSON.stringify({view:'dashboard',period:'month',anchor:date}));
    localStorage.setItem('contaai-tombstones-v1','[]');
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key,value) { if(key!=='contaai-ui-state-v1') return nativeSetItem.call(this,key,value); };
    location.reload(); return true;
  })()`);
  // A navegação destrói o contexto antigo; a verificação seguinte aguarda o novo.
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await devTools.evaluate("document.querySelector('#recentTransactions')?.textContent.includes('Supermercado de teste')").catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  const planning = await devTools.evaluate(`({forecast:document.querySelector('#forecastPanel').textContent,insight:document.querySelector('#insightsPanel').textContent,goal:document.querySelector('#goalsGrid').textContent})`);
  assert(planning.forecast.includes('4.000,00') && planning.insight.includes('90%') && planning.goal.includes('/mês'), `${name}: projeção, alerta de orçamento ou plano da meta incorreto`);

  for (const width of [320, 390, 768, 900, 1100, 1440]) {
    await devTools.command('Emulation.setDeviceMetricsOverride', {width, height:900, deviceScaleFactor:1, mobile:width < 821});
    for (const view of ['dashboard', 'transactions']) {
      await devTools.evaluate(`document.querySelector('[data-view="${view}"]').click(); true`);
      await new Promise(resolve => setTimeout(resolve, 60));
      const layout = await devTools.evaluate(`(() => {
        const active=document.querySelector('.view.active');
        const controls=[...active.querySelectorAll('.amount,.transaction-actions button,.bill-amount,.pay-button')].filter(e=>e.getClientRects().length);
        const outside=controls.filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}).map(e=>e.className);
        const chart=document.querySelector('#monthlyChart');
        return {outside,overflow:document.documentElement.scrollWidth>innerWidth+1,chartFits:!chart.clientWidth||chart.querySelector('svg').getBoundingClientRect().width<=chart.clientWidth+1};
      })()`);
      assert(!layout.overflow && !layout.outside.length && layout.chartFits, `${name}: conteúdo cortado em ${width}px/${view}: ${JSON.stringify(layout)}`);
    }
  }
  await devTools.evaluate(`document.querySelector('[data-view="dashboard"]').click(); document.querySelector('[data-chart-month="5"]').scrollIntoView({block:'center',behavior:'instant'}); true`);
  const point = await devTools.evaluate(`(()=>{const r=document.querySelector('[data-chart-month="5"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await devTools.command('Input.dispatchMouseEvent', {type:'mouseMoved',...point});
  const hover = await devTools.evaluate("({visible:!document.querySelector('.chart-tooltip').classList.contains('hidden'),text:document.querySelector('.chart-tooltip').textContent})");
  assert(hover.visible && hover.text.includes('5.000,00') && hover.text.includes('1.000,00') && hover.text.includes('4.000,00'), `${name}: tooltip não responde ao mouse com os valores corretos`);
  await devTools.evaluate(`document.querySelector('[data-chart-month="5"]').focus(); true`);
  await devTools.command('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft',windowsVirtualKeyCode:37});
  assert(await devTools.evaluate("document.activeElement.dataset.chartMonth === '4' && !document.querySelector('.chart-tooltip').classList.contains('hidden')"), `${name}: navegação por teclado no gráfico falhou`);
  await devTools.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert(await devTools.evaluate("document.querySelector('.chart-tooltip').classList.contains('hidden')"), `${name}: Escape não fechou o tooltip`);

  await devTools.command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await devTools.command('Emulation.setTouchEmulationEnabled',{enabled:true});
  await devTools.evaluate(`document.querySelector('[data-chart-month="5"]').scrollIntoView({block:'center',behavior:'instant'}); true`);
  const touch = await devTools.evaluate(`(()=>{const r=document.querySelector('[data-chart-month="5"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await devTools.command('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});
  await devTools.command('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert(await devTools.evaluate("!document.querySelector('.chart-tooltip').classList.contains('hidden') && document.querySelector('.chart-tooltip').textContent.includes('5.000,00')"), `${name}: o toque não revelou os dados do gráfico`);
  await devTools.command('Emulation.setTouchEmulationEnabled',{enabled:false});
  await devTools.evaluate(`document.querySelector('.mobile-nav [data-view="transactions"]').click(); true`);
  assert(await devTools.evaluate(`document.querySelector('#transactionsView').classList.contains('active') && document.querySelector('.mobile-nav [data-view="transactions"]').getAttribute('aria-current')==='page'`),`${name}: navegação mobile não atualizou a tela e o estado ativo`);

  await devTools.evaluate(`document.querySelector('.mobile-add').click(); true`);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert(await devTools.evaluate("document.querySelector('#app').inert && document.querySelector('#transactionModal').contains(document.activeElement)"), `${name}: o foco não entrou no modal`);
  await devTools.evaluate(`document.querySelector('#transactionSubmit').focus(); true`);
  await devTools.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert(await devTools.evaluate("document.activeElement === document.querySelector('#transactionModal .close-modal')"),`${name}: Tab saiu do modal`);
  await devTools.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  assert(await devTools.evaluate("!document.querySelector('#app').inert && document.activeElement===document.querySelector('.mobile-add')"),`${name}: fechar o modal não restaurou o foco`);

  const recurrence = await devTools.evaluate(`(() => {
    document.querySelector('[data-view="recurring"]').click();
    document.querySelector('#nextPeriod').click();
    const id=document.querySelector('#recurringGrid [data-toggle-paid]').dataset.togglePaid;
    const pending=!document.querySelector('#recurringGrid [data-toggle-paid]').checked;
    const before=JSON.parse(localStorage.getItem('contaai-transactions-v2')).length;
    document.querySelector('#openPDFExport').click();
    const exportForm=document.querySelector('#exportForm');
    exportForm.elements.period.value='month';
    exportForm.elements.month.value=JSON.parse(localStorage.getItem('contaai-ui-state-v1')).anchor.slice(0,7);
    exportForm.elements.includePending.checked=true;
    exportForm.elements.includePending.dispatchEvent(new Event('change',{bubbles:true}));
    const projectedPreview=document.querySelector('#exportPreview').textContent;
    const projectedReport=projectedPreview.includes('100,00');
    document.querySelector('#exportModal .close-modal').click();
    document.querySelector('#recurringGrid [data-edit]').click();
    const editPrefilled=document.querySelector('#transactionForm').elements.title.value==='Internet mensal';
    document.querySelector('#transactionModal .close-modal').click();
    const cancelKeptCount=JSON.parse(localStorage.getItem('contaai-transactions-v2')).length===before;
    document.querySelector('#recurringGrid [data-toggle-paid]').click();
    const saved=JSON.parse(localStorage.getItem('contaai-transactions-v2'));
    return {id,pending,before,projectedReport,projectedPreview,editPrefilled,cancelKeptCount,after:saved.length,original:saved.find(e=>e.id==='new-fixed'),paid:saved.find(e=>e.id===id),forecast:document.querySelector('#forecastPanel').textContent};
  })()`);
  assert(recurrence.pending && recurrence.after === recurrence.before+1 && recurrence.paid?.paid && recurrence.paid?.recurrenceParent==='new-fixed' && recurrence.original.paid,`${name}: pagar a próxima recorrência perdeu ou duplicou o histórico`);
  assert(recurrence.projectedReport && recurrence.editPrefilled && recurrence.cancelKeptCount,`${name}: relatório ou cancelamento da edição de parcela projetada: ${JSON.stringify({projectedPreview:recurrence.projectedPreview,editPrefilled:recurrence.editPrefilled,cancelKeptCount:recurrence.cancelKeptCount})}`);
  const stopped = await devTools.evaluate(`(() => {
    document.querySelector('#nextPeriod').click();
    document.querySelector('[data-stop-recurring="new-fixed"]').click();
    document.querySelector('#nextPeriod').click();
    const noMore=document.querySelectorAll('#recurringGrid [data-toggle-paid]').length===0;
    const saved=JSON.parse(localStorage.getItem('contaai-transactions-v2'));
    document.querySelector('#goToday').click();
    return {noMore,history:saved.filter(e=>e.recurring&&e.paid).length};
  })()`);
  assert(stopped.noMore && stopped.history===2,`${name}: encerrar a recorrência alterou o histórico ou não interrompeu as parcelas`);
  await devTools.evaluate(`(() => {
    document.querySelector('[data-view="dashboard"]').click();
    localStorage.setItem('contaai-transactions-v2','[]');
    window.dispatchEvent(new StorageEvent('storage',{key:'contaai-transactions-v2',newValue:'[]'}));
    return true;
  })()`);
  await devTools.command('Emulation.setDeviceMetricsOverride',{width:440,height:844,deviceScaleFactor:1,mobile:true});
  await new Promise(resolve => setTimeout(resolve,80));
  assert(await devTools.evaluate("Boolean(document.querySelector('#monthlyChart .empty-state')) && !document.querySelector('#monthlyChart .trend-chart')"),`${name}: redimensionar a tela restaurou um gráfico com dados antigos`);
  const oldNavigation = await devTools.evaluate("performance.timeOrigin");
  await devTools.evaluate(`(() => {
    localStorage.setItem('contaai-ui-state-v1',JSON.stringify({view:'dashboard',period:'month',anchor:'2024-01-31'}));
    const nativeSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key!=='contaai-ui-state-v1')return nativeSetItem.call(this,key,value)};
    location.reload(); return true;
  })()`);
  for(let attempt=0;attempt<100;attempt++) {
    if(await devTools.evaluate(`performance.timeOrigin!==${oldNavigation} && document.readyState==='complete' && document.querySelector('#periodLabel')?.textContent.includes('janeiro')`).catch(()=>false))break;
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  assert(await devTools.evaluate(`document.querySelector('#nextPeriod').click(); document.querySelector('#periodLabel').textContent.includes('fevereiro')`),`${name}: navegar a partir do dia 31 pulou fevereiro`);
  process.stdout.write(`✓ ${name}: gráfico com mouse/toque/teclado, 6 larguras, foco, projeção e recorrências validados\n`);
}
