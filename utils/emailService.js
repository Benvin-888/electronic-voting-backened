const nodemailer = require('nodemailer');
const config = require('../config');

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.port === 465, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass
  },
  tls: {
    // Explicitly specify TLS version
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    rejectUnauthorized: false // For testing only
  },
  // Alternative SSL settings
  requireTLS: true,
  debug: true // Enable debugging
});

const sendRegistrationEmail = async (voter, votingNumber) => {
  const mailOptions = {
    from: config.email.from,
    to: voter.email,
    subject: 'Voter Registration Confirmation - Kirinyaga County Elections',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
            .content { padding: 30px; background-color: #f9f9f9; }
            .voting-number { 
              background-color: #fff3cd; 
              border: 2px dashed #856404; 
              padding: 15px; 
              text-align: center; 
              font-size: 24px; 
              font-weight: bold; 
              margin: 20px 0;
              letter-spacing: 2px;
            }
            .instructions { margin-top: 30px; }
            .footer { 
              margin-top: 30px; 
              padding-top: 20px; 
              border-top: 1px solid #ddd; 
              font-size: 12px; 
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Kirinyaga County Electronic Voting System</h1>
            </div>
            <div class="content">
              <h2>Dear ${voter.fullName},</h2>
              <p>Your voter registration has been successfully completed.</p>
              
              <div class="voting-number">
                Your Voting Number: ${votingNumber}
              </div>
              
              <div class="instructions">
                <h3>Voting Instructions:</h3>
                <ol>
                  <li><strong>Keep your voting number confidential</strong> - Do not share it with anyone</li>
                  <li>On election day, visit the voting portal</li>
                  <p><em>Voting Portal URL: <a href="https://user-voting-site-2026-ke.web.app" target="_blank">https://user-voting-site-2026-ke.web.app</a></em></p>
                  <li>Log in using your voting number</li>
                  <li>Follow the on-screen instructions to cast your vote</li>
                  <li>Voting portal will be open during specified hours only</li>
                  <li>Each voting number can only be used once</li>
                </ol>
                
                <p><strong>Your Voting Details:</strong></p>
                <ul>
                  <li>County: ${voter.county}</li>
                  <li>Constituency: ${voter.constituency}</li>
                  <li>Ward: ${voter.ward}</li>
                </ul>
              </div>
              
              <p style="color: #d32f2f;">
                <strong>Important:</strong> If you did not register for voting, please contact the election commission immediately.
              </p>
            </div>
            <div class="footer">
              <p>This is an automated message from Kirinyaga County Election Commission.</p>
              <p>© ${new Date().getFullYear()} Kirinyaga County Government. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Registration email sent to ${voter.email}`);
    return true;
  } catch (error) {
    console.error('Error sending registration email:', error);
    return false;
  }
};

const sendVoteConfirmationEmail = async (voter) => {
  const mailOptions = {
    from: config.email.from,
    to: voter.email,
    subject: 'Vote Confirmation - Kirinyaga County Elections',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
            .content { padding: 30px; background-color: #f9f9f9; }
            .success-icon { 
              color: #4CAF50; 
              font-size: 48px; 
              text-align: center; 
              margin: 20px 0;
            }
            .footer { 
              margin-top: 30px; 
              padding-top: 20px; 
              border-top: 1px solid #ddd; 
              font-size: 12px; 
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Kirinyaga County Electronic Voting System</h1>
            </div>
            <div class="content">
              <div class="success-icon">✓</div>
              <h2>Thank You for Voting, ${voter.fullName}!</h2>
              <p>Your vote has been successfully recorded in the Kirinyaga County elections.</p>
              
              <p><strong>Voting Details:</strong></p>
              <ul>
                <li>Time of Vote: ${new Date().toLocaleString()}</li>
                <li>County: ${voter.county}</li>
                <li>Constituency: ${voter.constituency}</li>
                <li>Ward: ${voter.ward}</li>
              </ul>
              
              <p style="margin-top: 30px;">
                You can now view live election results on the results page. 
                Your voting number has been disabled and cannot be used again.
              </p>
            </div>
            <div class="footer">
              <p>This is an automated confirmation from Kirinyaga County Election Commission.</p>
              <p>© ${new Date().getFullYear()} Kirinyaga County Government. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Vote confirmation email sent to ${voter.email}`);
    return true;
  } catch (error) {
    console.error('Error sending vote confirmation email:', error);
    return false;
  }
};

const sendPortalNotification = async (voters, notificationType) => {
  // Batch send portal opening/closing notifications
  const subject = notificationType === 'open' 
    ? 'Voting Portal Now Open - Kirinyaga County Elections'
    : 'Voting Portal Now Closed - Kirinyaga County Elections';
  
  const message = notificationType === 'open'
    ? 'The voting portal is now open. You can now cast your vote using your voting number.'
    : 'The voting portal is now closed. Thank you for participating in the elections.';

  // In production, implement batch email sending or use email service
  console.log(`Would send ${notificationType} notification to ${voters.length} voters`);
  return true;
};

module.exports = {
  sendRegistrationEmail,
  sendVoteConfirmationEmail,
  sendPortalNotification
};