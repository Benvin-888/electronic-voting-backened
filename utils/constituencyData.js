const constituencyData = {
  // Kirinyaga County constituencies and wards
  constituencies: [
    'Kirinyaga Central',
    'Kirinyaga East', 
    'Mwea',
    'Gichugu',
    'Ndia'
  ],
  
  wardsByConstituency: {
    'Kirinyaga Central': [
      'Kiamuturi',
      'Mutithi', 
      'Kangai',
      'Thiba',
      'Wamumu'
    ],
    'Kirinyaga East': [
      'Kanyeki-Inoi',
      'Kerugoya',
      'Inoi',
      'Mutonguni',
      'Kiamaciri'
    ],
    'Mwea': [
      'Thiba',
      'Kangai',
      'Mutithi',
      'Wamumu',
      'Mwea'
    ],
    'Gichugu': [
      'Ngariama',
      'Kanyekini',
      'Murinduko',
      'Gathigiriri',
      'Tebere'
    ],
    'Ndia': [
      'Baragwi',
      'Njukiini',
      'Gichugu',
      'Mukure',
      'Kiaritha'
    ]
  },
  
  getWardsByConstituency: (constituency) => {
    return constituencyData.wardsByConstituency[constituency] || [];
  },
  
  validateWard: (constituency, ward) => {
    const wards = constituencyData.wardsByConstituency[constituency];
    return wards ? wards.includes(ward) : false;
  },
  
  getAllWards: () => {
    const allWards = [];
    Object.values(constituencyData.wardsByConstituency).forEach(wards => {
      allWards.push(...wards);
    });
    return [...new Set(allWards)]; // Remove duplicates
  },
  
  getConstituencyByWard: (ward) => {
    for (const [constituency, wards] of Object.entries(constituencyData.wardsByConstituency)) {
      if (wards.includes(ward)) {
        return constituency;
      }
    }
    return null;
  }
};

module.exports = constituencyData;