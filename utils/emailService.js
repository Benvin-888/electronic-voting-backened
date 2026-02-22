const SibApiV3Sdk = require('sib-api-v3-sdk');
const config = require('../config');

// Initialize Brevo API instance
let defaultClient = SibApiV3Sdk.ApiClient.instance;

// Configure API key authorization
let apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = config.brevo.apiKey;

// Create API instance
let apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

const sendRegistrationEmail = async (voter, votingNumber) => {
  try {
    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    
    // Using your configured sender
    sendSmtpEmail.sender = {
      email: config.brevo.fromEmail,
      name: config.brevo.fromName
    };
    
    sendSmtpEmail.to = [{
      email: voter.email,
      name: voter.fullName
    }];
    
    sendSmtpEmail.subject = 'Voter Registration Confirmation - Kirinyaga County Elections';
    
    sendSmtpEmail.htmlContent = `
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
                  <p><em>Voting Portal URL: <a href="https://user-voting-site-2026-ke.web.app/Voting.html" target="_blank">https://user-voting-site-2026-ke.web.app/Voting.html</a></em></p>
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
    `;

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`✅ Registration email sent to ${voter.email}. Message ID: ${data.messageId}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending registration email via Brevo:', error.message);
    if (error.response && error.response.text) {
      console.error('Brevo API Error Details:', error.response.text);
    }
    return false;
  }
};

const sendVoteConfirmationEmail = async (voter) => {
  try {
    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
    
    // Using your configured sender
    sendSmtpEmail.sender = {
      email: config.brevo.fromEmail,
      name: config.brevo.fromName
    };
    
    sendSmtpEmail.to = [{
      email: voter.email,
      name: voter.fullName
    }];
    
    sendSmtpEmail.subject = 'Vote Confirmation - Kirinyaga County Elections';
    
    sendSmtpEmail.htmlContent = `
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
    `;

    const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`✅ Vote confirmation email sent to ${voter.email}. Message ID: ${data.messageId}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending vote confirmation email via Brevo:', error.message);
    if (error.response && error.response.text) {
      console.error('Brevo API Error Details:', error.response.text);
    }
    return false;
  }
};

const sendPortalNotification = async (voters, notificationType) => {
  const subject = notificationType === 'open' 
    ? 'Voting Portal Now Open - Kirinyaga County Elections'
    : 'Voting Portal Now Closed - Kirinyaga County Elections';
  
  const message = notificationType === 'open'
    ? 'The voting portal is now open. You can now cast your vote using your voting number.'
    : 'The voting portal is now closed. Thank you for participating in the elections.';

  let successCount = 0;
  let failCount = 0;

  for (const voter of voters) {
    try {
      let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
      
      // Using your configured sender
      sendSmtpEmail.sender = {
        email: config.brevo.fromEmail,
        name: config.brevo.fromName
      };
      
      sendSmtpEmail.to = [{
        email: voter.email,
        name: voter.fullName
      }];
      
      sendSmtpEmail.subject = subject;
      
      sendSmtpEmail.htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <h2>Dear ${voter.fullName},</h2>
              <p>${message}</p>
              <p>Visit the voting portal at: <a href="https://user-voting-site-2026-ke.web.app/Voting.html">https://user-voting-site-2026-ke.web.app/Voting.html</a></p>
              <p>Thank you for participating in the Kirinyaga County elections.</p>
              <hr>
              <p style="font-size: 12px; color: #666;">This is an automated message from Kirinyaga County Election Commission.</p>
            </div>
          </body>
        </html>
      `;

      await apiInstance.sendTransacEmail(sendSmtpEmail);
      successCount++;
      console.log(`✅ Portal notification sent to ${voter.email}`);
      
      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`❌ Failed to send to ${voter.email}:`, error.message);
      failCount++;
    }
  }

  console.log(`📊 Portal notifications summary: ${successCount} successful, ${failCount} failed`);
  return { successCount, failCount };
};

module.exports = {
  sendRegistrationEmail,
  sendVoteConfirmationEmail,
  sendPortalNotification
};