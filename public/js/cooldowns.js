(() => {
  function tick(){
    const now=Math.floor(Date.now()/1000);
    for(const key of ['medical','drug']){
      const node=document.getElementById('header-'+key);if(!node)continue;
      const seconds=Math.max(0,Number(node.dataset.timer)-now);
      node.textContent=seconds?Math.floor(seconds/3600)+'h '+Math.ceil(seconds%3600/60)+'m':'Ready';
      node.title=seconds+' seconds remaining';
    }
  }
  tick();setInterval(tick,1000);
})();
