export function installWorkspaceSplitter(root,main,divider) {
    const key='adachi-workspace-sidebar-width',minimum=280,canvasMinimum=320;
    let requested=360,drag=null;
    try {const saved=Number(localStorage.getItem(key));if(Number.isFinite(saved) && saved>=minimum)requested=saved;}catch{}
    const bounds=()=>{
        const style=getComputedStyle(main),width=main.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
        return {width,max:Math.max(minimum,Math.min(760,width-canvasMinimum-10))};
    };
    const render=()=>{
        const {width,max}=bounds(),actual=Math.min(max,Math.max(minimum,requested));
        root.style.setProperty('--aw-sidebar-width',`${actual}px`);
        divider.setAttribute('aria-valuemin',String(Math.min(canvasMinimum,width-minimum-10)));
        divider.setAttribute('aria-valuemax',String(Math.max(0,width-minimum-10)));
        divider.setAttribute('aria-valuenow',String(Math.max(0,width-actual-10)));
        divider.setAttribute('aria-valuetext',`右侧配置 ${Math.round(actual)} 像素`);
        return actual;
    };
    const save=()=>{try{localStorage.setItem(key,String(requested));}catch{}};
    const change=value=>{requested=Math.min(bounds().max,Math.max(minimum,value));render();};
    divider.setAttribute('role','separator');divider.setAttribute('aria-orientation','vertical');
    divider.setAttribute('aria-label','调整画布与配置宽度');divider.tabIndex=0;
    divider.title='拖动调整画布与配置宽度；双击恢复，方向键微调';
    divider.onpointerdown=e=>{
        if(e.button!==0)return;e.preventDefault();e.stopPropagation();
        drag={id:e.pointerId,x:e.clientX,width:render()};divider.setPointerCapture(e.pointerId);
        root.dataset.resizing='true';divider.focus({preventScroll:true});
    };
    divider.onpointermove=e=>{if(drag?.id!==e.pointerId)return;e.preventDefault();change(drag.width+drag.x-e.clientX);};
    const finish=e=>{
        if(drag?.id!==e.pointerId)return;drag=null;delete root.dataset.resizing;
        if(divider.hasPointerCapture(e.pointerId))divider.releasePointerCapture(e.pointerId);save();
    };
    divider.onpointerup=finish;divider.onpointercancel=finish;divider.onlostpointercapture=finish;
    divider.ondblclick=e=>{e.preventDefault();requested=360;render();save();};
    divider.onkeydown=e=>{
        const step=e.shiftKey?48:16;
        if(e.key==='ArrowLeft')change(render()+step);
        else if(e.key==='ArrowRight')change(render()-step);
        else if(e.key==='Home')change(bounds().max);
        else if(e.key==='End')change(minimum);
        else if(e.key==='Enter'){requested=360;render();}
        else return;
        e.preventDefault();e.stopPropagation();save();
    };
    const observer=new ResizeObserver(render);observer.observe(main);render();
    return ()=>{observer.disconnect();delete root.dataset.resizing;};
}
