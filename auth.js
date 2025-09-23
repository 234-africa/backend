const verifyGoogleAccessTokenMiddleware = async (req, res, next) => {
  try {
    const { access_token } = req.body;
    oauth2Client.setCredentials({ access_token });

    const userinfo = await oauth2Client.request({
      url: "https://www.googleapis.com/oauth2/v3/userinfo",
    });

    req.userinfo = userinfo.data;
    next();
  } catch (error) {
    console.error('Error verifying access token:', error);
    res.status(500).json({ message: 'Failed to verify access token' });
  }
};