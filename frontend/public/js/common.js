window.Nexus = {
  api: async (path, opts = {}) => {
    const token = localStorage.getItem('nexus_token');
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(()=>({}));
    if(!res.ok) {
      alert(data.error || 'Error en la petición');
      if(res.status === 401) Nexus.logout();
      throw new Error(data.error);
    }
    return data;
  },
  
  // 🔥 AQUÍ ESTÁ EL CAMBIO: location.href apunta a '/'
  logout: () => { 
      localStorage.clear(); 
      location.href = '/'; 
  },
  
  copyToClipboard: (text) => { 
      navigator.clipboard.writeText(text); 
      alert('¡Copiado al portapapeles!'); 
  }
};
