const auditLogger = require('../utils/auditLogger');

const auditLogMiddleware = async (req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    // Log after response is sent
    if (req.admin) {
      const action = getActionFromRoute(req.method, req.originalUrl);
      const entity = getEntityFromRoute(req.originalUrl);
      
      auditLogger.log(
        req.admin._id,
        action,
        entity,
        req.params.id || null,
        {
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
          ...(req.method !== 'GET' && req.body && { body: req.body })
        }
      );
    }
    
    return originalSend.call(this, data);
  };
  
  next();
};

const getActionFromRoute = (method, url) => {
  switch (method) {
    case 'POST':
      return 'CREATE';
    case 'PUT':
    case 'PATCH':
      return 'UPDATE';
    case 'DELETE':
      return 'DELETE';
    case 'GET':
      return url.includes('export') ? 'EXPORT' : 'VIEW';
    default:
      return 'OTHER';
  }
};

const getEntityFromRoute = (url) => {
  if (url.includes('/voters')) return 'Voter';
  if (url.includes('/candidates')) return 'Candidate';
  if (url.includes('/voting')) return 'Vote';
  if (url.includes('/settings')) return 'SystemSetting';
  if (url.includes('/admin')) return 'Admin';
  if (url.includes('/results')) return 'Result';
  return 'System';
};

module.exports = auditLogMiddleware;