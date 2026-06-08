require('dotenv').config({ path: '../.env' });

const email = process.argv[2];

if (!email) {
    console.error('Usage: node assign-admin-role.js <user-email>');
    process.exit(1);
}

if (!process.env.CLERK_SECRET_KEY) {
    console.error('Error: CLERK_SECRET_KEY is not set in .env');
    process.exit(1);
}

async function assignAdminRole() {
    try {
        const { createClerkClient } = require('@clerk/clerk-sdk-node');
        const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

        const users = await clerkClient.users.getUserList({
            emailAddress: [email]
        });

        if (!users || users.data.length === 0) {
            console.error(`User not found with email: ${email}`);
            process.exit(1);
        }

        const user = users.data[0];
        
        await clerkClient.users.updateUser(user.id, {
            publicMetadata: {
                ...user.publicMetadata,
                role: 'admin'
            }
        });

        console.log(`Successfully assigned admin role to user ${user.id} (${email})`);
    } catch (err) {
        console.error('Failed to assign admin role:', err);
        process.exit(1);
    }
}

assignAdminRole();
